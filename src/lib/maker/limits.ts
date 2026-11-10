import "server-only";
/**
 * Abuse and cost protection for the public Maker tools (Components, Open hardware, PCB planner).
 *
 * Three separate things, as the pre-launch audit recommends:
 *   1. Request rate per visitor (IP) and bucket: shared across serverless instances through Upstash
 *      Redis when it is configured, with an in-process window as a floor (and the only limit without Redis).
 *   2. Paid upstream budget per distributor (DigiKey, Mouser): reserved BEFORE each real call, per day for
 *      the whole site and per visitor. If Redis is configured but unreachable, paid calls are refused
 *      (fail closed); browsing, cached data and local tools keep working.
 *   3. A shared cache for distributor answers (Redis when configured, plus memory), with identical
 *      in-flight lookups merged so a burst of the same query makes one upstream call.
 */
import { Redis } from "@upstash/redis";
import { SourceError } from "./server";
import { currentWho, outsideRequest, redisSignal, remainingMs } from "./request-context";

/**
 * Every Redis command is bounded by the current request's time left (at most 3 s, see redisSignal) and
 * retried at most once inside that time: a slow or unreachable Redis cannot hold a request past its
 * deadline. A command cut off counts as a failure — budgets then refuse the paid call (fail closed).
 */
export function makeRedis(url: string, token: string) {
  return new Redis({ url, token, signal: redisSignal, retry: { retries: 1, backoff: () => 50 } });
}
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
let redis: Redis | null = url && token ? makeRedis(url, token) : null;

/** Tests only: replace the Redis client (null = not configured). */
export function __setRedisForTests(r: unknown) {
  redis = r as Redis | null;
}

/* ------------------------------------------------------------------ 1. request rate */

export type Bucket = "api" | "files" | "translate" | "github";
/** Requests per minute per visitor. "files" covers datasheets, CAD libraries and 3D models (a board loads many). */
const PER_MINUTE: Record<Bucket, number> = { api: 120, files: 240, translate: 20, github: 20 };

const local = new Map<string, { n: number; reset: number }>();
function localHit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (local.size > 20000) for (const [k, v] of local) if (v.reset < now) local.delete(k);
  const x = local.get(key);
  if (!x || x.reset <= now) {
    local.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  return ++x.n <= limit;
}

/** INCRBY + EXPIRE in one step (a counter can never be left without its expiry). */
const COUNT_LUA = `-- count
local n = redis.call('INCRBY', KEYS[1], tonumber(ARGV[1]))
if n == tonumber(ARGV[1]) or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
return n`;

/** Fixed one-minute window in Redis. Returns the count, or null when Redis failed. */
async function redisCount(key: string, ttlSeconds: number, by = 1): Promise<number | null> {
  if (!redis) return null;
  try {
    return Number(await redis.eval(COUNT_LUA, [key], [String(by), String(ttlSeconds)]));
  } catch {
    return null;
  }
}

/** Throws 429 when this visitor is over the bucket's rate. Rate limits fail open if Redis is down. */
export async function limitRequest(visitorKey: string, bucket: Bucket = "api", factor = 1) {
  const limit = PER_MINUTE[bucket] * factor;
  if (!localHit(`${bucket}:${visitorKey}`, limit, 60_000)) throw new SourceError("Too many requests. Try again in a minute.", 429);
  const minute = Math.floor(Date.now() / 60_000);
  const n = await redisCount(`mk:rate:${bucket}:${visitorKey}:${minute}`, 90);
  if (n !== null && n > limit) throw new SourceError("Too many requests. Try again in a minute.", 429);
}

/* ------------------------------------------------------------------ 2. paid distributor budget */

export type Provider = "digikey" | "mouser" | "ezplm";
const day = () => new Date().toISOString().slice(0, 10);
/** A budget from the environment; "0" means switched off (not "use the default"). */
export function envBudget(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
/** Site-wide calls per day (leave headroom under the account's real quota) and per visitor per day. */
const siteDaily = (p: Provider) =>
  p === "ezplm" ? envBudget("EZPLM_DAILY_BUDGET", 800) : envBudget(p === "digikey" ? "DIGIKEY_DAILY_BUDGET" : "MOUSER_DAILY_BUDGET", 800);
const visitorDaily = () => envBudget("SUPPLIER_VISITOR_DAILY_BUDGET", 150);

/**
 * Paid calls need a ledger every instance shares. In production that is Redis; without it paid calls
 * are refused (browsing, cached answers and local tools keep working). MAKER_LOCAL_BUDGET=1 allows a
 * per-instance ledger explicitly (development, single-instance hosting); outside production it is the default.
 */
const localLedgerAllowed = () => process.env.MAKER_LOCAL_BUDGET === "1" || process.env.NODE_ENV !== "production";

/**
 * Atomic check-and-reserve over several budgets (site, network, visitor…): every budget is checked
 * first and all are charged only if all allow it. A refused request charges nothing (it is counted
 * under a separate "denied" key for monitoring). KEYS[1..n] budgets, KEYS[n+1] the denied counter;
 * ARGV[1] amount, ARGV[2..n+1] the limits.
 */
const RESERVE_LUA = `
local amount = tonumber(ARGV[1])
local n = #KEYS - 1
for i = 1, n do
  local used = tonumber(redis.call('GET', KEYS[i]) or '0')
  if used + amount > tonumber(ARGV[i + 1]) then
    redis.call('INCR', KEYS[n + 1]); redis.call('EXPIRE', KEYS[n + 1], 172800)
    return 0
  end
end
for i = 1, n do
  redis.call('INCRBY', KEYS[i], amount); redis.call('EXPIRE', KEYS[i], 172800)
end
return 1`;

const localSpend = new Map<string, number>();
/**
 * Reserve `amount` units of several daily budgets at once ([key, limit] pairs, e.g. the site's, the
 * network's and the visitor's). false = do not spend: over any budget, a budget of 0, Redis configured
 * but failing, or no shared ledger in production. Nothing is charged when the answer is false.
 */
export async function reserveBudgets(name: string, amount: number, budgets: [string, number][]): Promise<boolean> {
  if (amount <= 0) return true;
  if (budgets.some(([, limit]) => limit <= 0)) return false;
  const d = day();
  const keys = budgets.map(([k]) => `mk:budget:${name}:${d}${k ? ":" + k : ""}`);
  if (redis) {
    try {
      const ok = await redis.eval(RESERVE_LUA, [...keys, `mk:denied:${name}:${d}`], [String(amount), ...budgets.map(([, l]) => String(l))]);
      return Number(ok) === 1;
    } catch {
      return false; // fail closed: never spend paid quota without a working ledger
    }
  }
  if (!localLedgerAllowed()) return false;
  if (localSpend.size > 20000) localSpend.clear();
  if (keys.some((k, i) => (localSpend.get(k) || 0) + amount > budgets[i][1])) return false;
  keys.forEach((k) => localSpend.set(k, (localSpend.get(k) || 0) + amount));
  return true;
}

/** Two budgets: site-wide and this visitor's (see reserveBudgets). */
export function reserveDaily(name: string, visitorKey: string, amount: number, siteLimit: number, visitorLimit: number): Promise<boolean> {
  return reserveBudgets(name, amount, [["", siteLimit], [visitorKey, visitorLimit]]);
}

/**
 * The budgets a request is charged against: the site's; the network's (hashed IP, a looser allowance
 * shared by everyone behind it); and the visitor's own (their anonymous session, or the IP without one).
 */
function visitorBudgets(fallbackKey: string, site: number, visitor: number, network: number): [string, number][] {
  const who = currentWho();
  if (!who) return [["", site], [fallbackKey, visitor]];
  return [["", site], ["net:" + who.ip, network], [(who.sid ? "s:" + who.sid : "net1:" + who.ip), visitor]];
}

/** Reserve one real call to a distributor for this visitor (see reserveDaily). */
export function reserveSupplierCall(provider: Provider, visitorKey: string) {
  return reserveBudgets(provider, 1, visitorBudgets(visitorKey, siteDaily(provider), visitorDaily(), envBudget("SUPPLIER_NETWORK_DAILY_BUDGET", 600)));
}

/**
 * Machine-translation characters per day (Azure bills the characters actually sent). `visitorKey` null =
 * translation the server does on its own (part details, search results): only the site budget applies.
 */
export function reserveTranslation(visitorKey: string | null, chars: number) {
  const site = envBudget("TRANSLATE_DAILY_CHARS", 300_000);
  if (!visitorKey) return reserveBudgets("translate", chars, [["", site]]);
  const mine = envBudget("TRANSLATE_VISITOR_DAILY_CHARS", 30_000);
  return reserveBudgets("translate", chars, visitorBudgets(visitorKey, site, mine, mine * 5));
}

/** After a distributor answers 429: stop calling it for a while (Retry-After when given), with the reason shown to visitors. */
const cooldowns = new Map<Provider, { until: number; reason: string }>();
export function supplierCooldown(provider: Provider, seconds = 300, reason = "") {
  const s = Math.min(3600, Math.max(30, seconds));
  cooldowns.set(provider, { until: Date.now() + s * 1000, reason });
  if (redis) void redis.set(`mk:cooldown:${provider}`, reason || "1", { ex: s }).catch(() => undefined);
}
/** false, or the reason this distributor is not being called right now ("" = no reason recorded). */
export async function supplierCoolingDown(provider: Provider): Promise<string | false> {
  const local = cooldowns.get(provider);
  if (local && local.until > Date.now()) return local.reason;
  if (!redis) return false;
  try {
    const v = await redis.get<string>(`mk:cooldown:${provider}`);
    return v === null || v === undefined ? false : v === "1" ? "" : String(v);
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ 3. shared distributor cache */

/** Cache key: provider + query with case and spacing normalised (part-number punctuation kept). */
export const supplierCacheKey = (provider: Provider, query: string) =>
  `mk:sup:${provider}:${query.trim().replace(/\s+/g, " ").toUpperCase().slice(0, 160)}`;

const memo = new Map<string, { until: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const TTL = envBudget("SUPPLIER_CACHE_SECONDS", 3600) || 3600;
const RELEASE_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fromRedis<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const v = await redis.get<T>(key);
    return v === null || v === undefined ? null : v;
  } catch {
    return null;
  }
}

/** `p`, or SupplierUnavailable once `deadline` (or the request's own deadline / cancel) passes first. */
function untilDeadline<T>(p: Promise<T>, deadline: number): Promise<T> {
  const ms = Math.min(deadline - Date.now(), remainingMs());
  if (ms <= 0) return Promise.reject(new SupplierUnavailable("Not enough time left for a live lookup"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new SupplierUnavailable("Another visitor is fetching this price — try again in a moment")), ms))),
  ]).finally(() => clearTimeout(timer));
}

/** A live lookup was not started (budget, cooldown, deadline, shared lock unavailable): shown as-is. */
export class SupplierUnavailable extends Error {}

/** Longer than any request can run (functions stop at 60 s), so a live holder never loses its lock. */
const LOCK_MS = 65_000;

/**
 * Cached distributor answer: memory, then Redis, then `load` — and only the request holding the
 * shared lock for this key may call `load` (each call can spend paid quota):
 *  - on this instance identical lookups share one promise;
 *  - across instances the others poll the cache and retry the lock until `deadline`, then give up
 *    with SupplierUnavailable (never load without the lock);
 *  - if Redis cannot be reached, no new paid lookup is started (cached answers still work).
 * Only successful answers are cached; errors (429, auth, timeouts) are never stored as "no result".
 */
export async function supplierCached<T>(key: string, load: () => Promise<T>, deadline = Date.now() + 20_000, ttl = TTL): Promise<{ value: T; cached: boolean }> {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return { value: hit.value as T, cached: true };
  const stored = await fromRedis<T>(key);
  if (stored !== null) {
    memo.set(key, { until: Date.now() + 60_000, value: stored });
    return { value: stored, cached: true };
  }
  const running = inflight.get(key) as Promise<T> | undefined;
  // Waiting on another request's lookup: this request still leaves at its own deadline.
  if (running) return { value: await untilDeadline(running, deadline), cached: true };
  if (Math.min(deadline - Date.now(), remainingMs()) < 1_500) throw new SupplierUnavailable("Not enough time left for a live lookup");
  const keep = async (value: T) => {
    if (memo.size > 5000) memo.clear();
    memo.set(key, { until: Date.now() + ttl * 1000, value });
    const r = redis;
    // Stored even if this request's time ran out meanwhile: a paid answer is never thrown away.
    if (r) await outsideRequest(() => r.set(key, value as any, { ex: ttl })).catch(() => undefined);
    return value;
  };
  const p = (async (): Promise<T> => {
    if (!redis) return keep(await load()); // no shared store: in-process merging only (paid calls still need the ledger)
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    for (;;) {
      let got: unknown;
      try {
        got = await redis.set(`${key}:lock`, token, { nx: true, px: LOCK_MS });
      } catch {
        throw new SupplierUnavailable("Live prices are unavailable right now");
      }
      if (got === "OK") {
        try {
          const again = await fromRedis<T>(key); // filled while we were acquiring
          if (again !== null) return again;
          return await keep(await load());
        } finally {
          // Released even when this request's time is up (else the lock blocks others for LOCK_MS).
          const r = redis;
          await outsideRequest(() => r.eval(RELEASE_LUA, [`${key}:lock`], [token])).catch(() => undefined);
        }
      }
      const v = await fromRedis<T>(key);
      if (v !== null) return v;
      if (deadline - Date.now() < 1_500) throw new SupplierUnavailable("Another visitor is fetching this price — try again in a moment");
      await sleep(250);
    }
  })();
  inflight.set(key, p);
  try {
    return { value: await p, cached: false };
  } finally {
    inflight.delete(key);
  }
}

/**
 * Per-minute rate for the current visitor: their anonymous session (or IP without one), plus a looser
 * allowance for the whole network (IP) so many sessions from one address cannot multiply it.
 */
export async function limitVisitor(bucket: Bucket, fallbackKey: string) {
  const who = currentWho();
  if (!who) return limitRequest(fallbackKey, bucket);
  await limitRequest(who.sid ? "s:" + who.sid : who.ip, bucket);
  if (who.sid) await limitRequest("net:" + who.ip, bucket, 4);
}

/** For routes outside the Maker catch-all: a 429 Response when over the bucket's rate, else null. */
export async function limitRoute(req: Request, bucket: Bucket): Promise<Response | null> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const { createHash } = await import("node:crypto");
  try {
    await limitVisitor(bucket, createHash("sha256").update(ip).digest("hex").slice(0, 32));
    return null;
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Too many requests." }, { status: 429, headers: { "Retry-After": "60" } });
  }
}


/* ------------------------------------------------------------------ 4. long-term use (anti-enumeration) */

/**
 * Different resources opened per day: part and design pages and their CAD ("detail"), and files
 * (datasheets, CAD files, 3D models — a board loads many, so the allowance is larger). Revisiting a
 * resource already admitted today is free. Per visitor (session, else IP) and, looser, per network (IP).
 *
 * Admission is one atomic step over both subjects: a resource is admitted only if every subject that
 * has not seen it yet still has room, and only then is it marked "seen" and counted for them. A refused
 * resource leaves no mark, so retrying it (or many at once) stays refused (fourth audit F01).
 *
 * Only responses this function runs for are counted: controlled data (part / design details, ezPLM
 * files) is never put in the shared CDN cache, so every visit reaches this check (F02).
 */
const DISTINCT: Record<"detail" | "file", { visitor: string; network: string; v: number; n: number }> = {
  detail: { visitor: "MAKER_DAILY_DETAILS", network: "MAKER_NETWORK_DAILY_DETAILS", v: 600, n: 3000 },
  file: { visitor: "MAKER_DAILY_FILES", network: "MAKER_NETWORK_DAILY_FILES", v: 4000, n: 20000 },
};
const localSeen = new Map<string, number>();

/** KEYS = seen1, count1, seen2, count2…; ARGV[1] ttl seconds, ARGV[2..] the limits. 1 = admitted. */
const ADMIT_LUA = `-- admit
local ttl = tonumber(ARGV[1])
local n = #KEYS / 2
local fresh = {}
for i = 1, n do
  if redis.call('EXISTS', KEYS[2 * i - 1]) == 0 then
    if tonumber(redis.call('GET', KEYS[2 * i]) or '0') + 1 > tonumber(ARGV[i + 1]) then return 0 end
    fresh[#fresh + 1] = i
  end
end
for _, i in ipairs(fresh) do
  redis.call('SET', KEYS[2 * i - 1], '1', 'EX', ttl)
  redis.call('INCR', KEYS[2 * i]); redis.call('EXPIRE', KEYS[2 * i], ttl)
end
return 1`;

/** The full resource identity, hashed (never truncated: two long URLs sharing a prefix stay distinct). */
async function resourceId(kind: string, id: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(kind + "\0" + id).digest("base64url").slice(0, 32);
}

const TOO_MANY = "You have opened a lot of different items today. Please come back tomorrow, or contact Tindie if you need bulk access.";

export async function noteResource(kind: "detail" | "file", id: string) {
  const who = currentWho();
  if (!who) return;
  const d = day();
  const rid = await resourceId(kind, id);
  const subjects: [string, number][] = [
    [who.sid ? "s:" + who.sid : "n1:" + who.ip, envBudget(DISTINCT[kind].visitor, DISTINCT[kind].v)],
    ["n:" + who.ip, envBudget(DISTINCT[kind].network, DISTINCT[kind].n)],
  ];
  const keys = subjects.flatMap(([subject]) => [`mk:seen:${d}:${kind}:${subject}:${rid}`, `mk:distinct:${d}:${kind}:${subject}`]);
  if (redis) {
    const r = redis;
    const ok = await r.eval(ADMIT_LUA, keys, [String(2 * 86400), ...subjects.map(([, l]) => String(l))]).catch(() => null);
    if (ok !== null) {
      if (Number(ok) !== 1) throw new SourceError(TOO_MANY, 429);
      return;
    }
    // Counting unavailable: fall back to this instance's own count (browsing is not blocked for it).
  }
  // Same rule in memory (synchronous, so atomic within the instance).
  if (localSeen.size > 50000) localSeen.clear();
  const fresh: number[] = [];
  for (let i = 0; i < subjects.length; i++) {
    if (localSeen.has(keys[2 * i])) continue;
    if ((localSeen.get(keys[2 * i + 1]) || 0) + 1 > subjects[i][1]) throw new SourceError(TOO_MANY, 429);
    fresh.push(i);
  }
  for (const i of fresh) {
    localSeen.set(keys[2 * i], 1);
    localSeen.set(keys[2 * i + 1], (localSeen.get(keys[2 * i + 1]) || 0) + 1);
  }
}

/* ------------------------------------------------------------------ 5. download bytes */

/**
 * Bytes downloaded per day through the file routes (3D models, ezPLM files, datasheets): the distinct-
 * file count does not limit fetching the same large file again and again. Checked before a download
 * starts (already over → 429) and charged as the bytes actually go out, so a download in progress is
 * never cut off half way. Per visitor and, looser, per network.
 */
function byteSubjects(): [string, number][] | null {
  const who = currentWho();
  if (!who) return null;
  const mb = 1024 * 1024;
  return [
    [`mk:bytes:${day()}:${who.sid ? "s:" + who.sid : "n1:" + who.ip}`, envBudget("MAKER_DAILY_DOWNLOAD_MB", 2000) * mb],
    [`mk:bytes:${day()}:n:${who.ip}`, envBudget("MAKER_NETWORK_DAILY_DOWNLOAD_MB", 10000) * mb],
  ];
}

export async function checkDownloadBudget() {
  const subjects = byteSubjects();
  if (!subjects) return;
  for (const [k, limit] of subjects) {
    let used = localSeen.get(k) || 0;
    if (redis) {
      const r = redis;
      const v = await r.get<number>(k).catch(() => null);
      if (v !== null && v !== undefined) used = Math.max(used, Number(v) || 0);
    }
    if (used >= limit) throw new SourceError("You have downloaded a lot of files today. Please come back tomorrow.", 429);
  }
}

/** `stream`, counting the bytes that pass through against today's download allowance. */
export function meteredStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const subjects = byteSubjects();
  if (!subjects) return stream;
  let pending = 0;
  const flush = () => {
    if (!pending) return;
    const n = pending;
    pending = 0;
    for (const [k] of subjects) {
      localSeen.set(k, (localSeen.get(k) || 0) + n);
      if (redis) void outsideRequest(() => redisCount(k, 2 * 86400, n));
    }
  };
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        pending += chunk.byteLength;
        if (pending >= 1024 * 1024) flush();
        c.enqueue(chunk);
      },
      flush,
    }),
  );
}

/** A file download: one more distinct file today, and the visitor not already over today's bytes. */
export async function admitFile(id: string) {
  await noteResource("file", id);
  await checkDownloadBudget();
}

/* ------------------------------------------------------------------ 6. concurrent jobs */

/**
 * At most `max` expensive jobs (BOM matching, GitHub scan / import) running at once per visitor, and
 * `network` per IP. Each job holds a lease of its own (a token with its own expiry, in a sorted set):
 * leases of jobs that died without releasing expire on their own, a refused request changes nothing
 * (it cannot keep a dead job's slot alive), and a job only ever releases its own lease (F04).
 */
const SLOT_LEASE_MS = 90_000;
/** KEYS the slot sets; ARGV[1] now, ARGV[2] lease ms, ARGV[3] token, ARGV[4..] limits. 1 = taken. */
const SLOT_TAKE_LUA = `-- slot-take
local now = tonumber(ARGV[1])
for i = 1, #KEYS do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now)
  if redis.call('ZCARD', KEYS[i]) >= tonumber(ARGV[i + 3]) then return 0 end
end
for i = 1, #KEYS do
  redis.call('ZADD', KEYS[i], now + tonumber(ARGV[2]), ARGV[3])
  redis.call('PEXPIRE', KEYS[i], tonumber(ARGV[2]))
end
return 1`;
const SLOT_FREE_LUA = `-- slot-free
for i = 1, #KEYS do redis.call('ZREM', KEYS[i], ARGV[1]) end
return 1`;
const localSlots = new Map<string, Map<string, number>>();

export async function withTaskSlot<T>(fn: () => Promise<T>, max = 2, network = 6): Promise<T> {
  const who = currentWho();
  if (!who) return fn();
  const keys = [`mk:jobs:${who.sid ? "s:" + who.sid : "n1:" + who.ip}`, `mk:jobs:n:${who.ip}`];
  const limits = [max, network];
  const token = crypto.randomUUID();
  const busy = () => new SourceError("Another job from you is still running — wait for it to finish, then try again.", 429);
  let shared = false;
  if (redis) {
    const r = redis;
    const ok = await r.eval(SLOT_TAKE_LUA, keys, [String(Date.now()), String(SLOT_LEASE_MS), token, ...limits.map(String)]).catch(() => null);
    if (ok !== null) {
      if (Number(ok) !== 1) throw busy();
      shared = true;
    }
  }
  if (!shared) {
    const now = Date.now();
    const sets = keys.map((k) => {
      let m = localSlots.get(k);
      if (!m) localSlots.set(k, (m = new Map()));
      for (const [t, until] of m) if (until <= now) m.delete(t);
      return m;
    });
    if (sets.some((m, i) => m.size >= limits[i])) throw busy();
    sets.forEach((m) => m.set(token, now + SLOT_LEASE_MS));
    if (localSlots.size > 20000) for (const [k, m] of localSlots) if (!m.size) localSlots.delete(k);
  }
  try {
    return await fn();
  } finally {
    const r = redis;
    if (shared && r) await outsideRequest(() => r.eval(SLOT_FREE_LUA, keys, [token])).catch(() => undefined);
    else keys.forEach((k) => localSlots.get(k)?.delete(token));
  }
}

/* ------------------------------------------------------------------ 7. shared cache for public data */

/**
 * Answers every visitor gets the same (parts database lists and details, GitHub repository facts),
 * shared through Redis so all serverless instances reuse them — each instance's memory cache alone
 * is cold most of the time. Public data only (no visitor-specific or private values). Best-effort:
 * without Redis, or if it fails or is slow, `load` simply runs. Values are wrapped ({ v }) so a
 * stored null ("no picture") is told apart from a miss; values over ~400 KB are not stored.
 */
export async function sharedValue<T>(key: string, ttlSeconds: number, load: () => Promise<T>, store: (v: T) => boolean = () => true): Promise<T> {
  const r = redis;
  if (r) {
    const hit = await r.get<{ v: T }>(key).catch(() => null);
    if (hit && typeof hit === "object" && "v" in hit) return hit.v;
  }
  const value = await load();
  if (r && store(value)) {
    const body = { v: value };
    if (JSON.stringify(body).length <= 400_000)
      void outsideRequest(() => r.set(key, body, { ex: Math.max(1, Math.floor(ttlSeconds)) })).catch(() => undefined);
  }
  return value;
}

/** Store several shared values in one round trip (see sharedValue; same { v } wrapping). */
export async function sharedPutMany(entries: [string, unknown][], ttlSeconds: number) {
  const r = redis;
  if (!r || !entries.length) return;
  await outsideRequest(async () => {
    const p = r.pipeline();
    for (const [k, v] of entries) p.set(k, { v }, { ex: Math.max(1, Math.floor(ttlSeconds)) });
    await p.exec();
  }).catch(() => undefined);
}

/** A value stored by sharedValue / sharedPutMany, or undefined when there is none (or no Redis). */
export async function sharedPeek<T>(key: string): Promise<T | undefined> {
  const r = redis;
  if (!r) return undefined;
  const hit = await r.get<{ v: T }>(key).catch(() => null);
  return hit && typeof hit === "object" && "v" in hit ? hit.v : undefined;
}

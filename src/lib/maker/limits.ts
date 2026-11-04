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
import { currentWho } from "./request-context";

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
let redis: Redis | null = url && token ? new Redis({ url, token }) : null;

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

/** Fixed one-minute window in Redis: INCR + EXPIRE on first hit. Returns the count, or null when Redis failed. */
async function redisCount(key: string, ttlSeconds: number): Promise<number | null> {
  if (!redis) return null;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, ttlSeconds);
    return n;
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

export type Provider = "digikey" | "mouser";
const day = () => new Date().toISOString().slice(0, 10);
/** A budget from the environment; "0" means switched off (not "use the default"). */
export function envBudget(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
/** Site-wide calls per day (leave headroom under the account's real quota) and per visitor per day. */
const siteDaily = (p: Provider) => envBudget(p === "digikey" ? "DIGIKEY_DAILY_BUDGET" : "MOUSER_DAILY_BUDGET", 800);
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

/** After a distributor answers 429: stop calling it for a while (Retry-After when given). */
const cooldowns = new Map<Provider, number>();
export function supplierCooldown(provider: Provider, seconds = 300) {
  cooldowns.set(provider, Date.now() + Math.min(3600, Math.max(30, seconds)) * 1000);
  if (redis) void redis.set(`mk:cooldown:${provider}`, "1", { ex: Math.min(3600, Math.max(30, seconds)) }).catch(() => undefined);
}
export async function supplierCoolingDown(provider: Provider) {
  if ((cooldowns.get(provider) || 0) > Date.now()) return true;
  if (!redis) return false;
  try {
    return (await redis.get(`mk:cooldown:${provider}`)) !== null;
  } catch {
    return true;
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
export async function supplierCached<T>(key: string, load: () => Promise<T>, deadline = Date.now() + 20_000): Promise<{ value: T; cached: boolean }> {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return { value: hit.value as T, cached: true };
  const stored = await fromRedis<T>(key);
  if (stored !== null) {
    memo.set(key, { until: Date.now() + 60_000, value: stored });
    return { value: stored, cached: true };
  }
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return { value: await running, cached: true };
  const keep = async (value: T) => {
    if (memo.size > 5000) memo.clear();
    memo.set(key, { until: Date.now() + TTL * 1000, value });
    if (redis) await redis.set(key, value as any, { ex: TTL }).catch(() => undefined);
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
          await redis.eval(RELEASE_LUA, [`${key}:lock`], [token]).catch(() => undefined);
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
 * Different resources opened per day (cached ones too): part and design pages ("detail"), and files
 * (datasheets, CAD files, 3D models — a board loads many, so the allowance is larger). Revisiting the
 * same resource is free. Per visitor (session, else IP) and, looser, per network (IP).
 */
const DISTINCT: Record<"detail" | "file", { visitor: string; network: string; v: number; n: number }> = {
  detail: { visitor: "MAKER_DAILY_DETAILS", network: "MAKER_NETWORK_DAILY_DETAILS", v: 600, n: 3000 },
  file: { visitor: "MAKER_DAILY_FILES", network: "MAKER_NETWORK_DAILY_FILES", v: 4000, n: 20000 },
};
const localSeen = new Map<string, number>();

export async function noteResource(kind: "detail" | "file", id: string) {
  const who = currentWho();
  if (!who) return;
  const d = day();
  const subjects: [string, number][] = [
    [who.sid ? "s:" + who.sid : "n1:" + who.ip, envBudget(DISTINCT[kind].visitor, DISTINCT[kind].v)],
    ["n:" + who.ip, envBudget(DISTINCT[kind].network, DISTINCT[kind].n)],
  ];
  const rid = id.slice(0, 200);
  for (const [subject, limit] of subjects) {
    const seenKey = `mk:seen:${d}:${kind}:${subject}:${rid}`;
    const countKey = `mk:distinct:${d}:${kind}:${subject}`;
    let count: number | null = null;
    if (redis) {
      try {
        const fresh = await redis.set(seenKey, 1, { nx: true, ex: 2 * 86400 });
        if (fresh !== "OK") continue; // already counted today
        count = await redis.incr(countKey);
        if (count === 1) await redis.expire(countKey, 2 * 86400);
      } catch {
        count = null; // counting unavailable: browsing is not blocked for it
      }
    }
    if (count === null) {
      if (localSeen.size > 50000) localSeen.clear();
      if (localSeen.has(seenKey)) continue;
      localSeen.set(seenKey, 1);
      count = (localSeen.get(countKey) || 0) + 1;
      localSeen.set(countKey, count);
    }
    if (count > limit)
      throw new SourceError("You have opened a lot of different items today. Please come back tomorrow, or contact Tindie if you need bulk access.", 429);
  }
}

/**
 * At most `max` expensive jobs (BOM matching, GitHub scan / import) running at once per visitor, and
 * `network` per IP. Slots expire on their own if a function dies mid-job.
 */
export async function withTaskSlot<T>(fn: () => Promise<T>, max = 2, network = 6): Promise<T> {
  const who = currentWho();
  if (!who) return fn();
  const keys: [string, number][] = [
    [`mk:busy:${who.sid ? "s:" + who.sid : "n1:" + who.ip}`, max],
    [`mk:busy:n:${who.ip}`, network],
  ];
  const taken: string[] = [];
  const release = async () => {
    for (const k of taken) {
      if (redis) await redis.decr(k).catch(() => undefined);
      else localSeen.set(k, Math.max(0, (localSeen.get(k) || 1) - 1));
    }
  };
  try {
    for (const [k, limit] of keys) {
      let n: number;
      if (redis) {
        try {
          n = await redis.incr(k);
          await redis.expire(k, 90);
        } catch {
          continue;
        }
      } else n = (localSeen.get(k) || 0) + 1, localSeen.set(k, n);
      taken.push(k);
      if (n > limit) throw new SourceError("Another job from you is still running — wait for it to finish, then try again.", 429);
    }
  } catch (e) {
    await release();
    throw e;
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}

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
export async function limitRequest(visitorKey: string, bucket: Bucket = "api") {
  const limit = PER_MINUTE[bucket];
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
 * Atomic check-and-reserve: both budgets are checked first and both are charged only if both allow it.
 * A refused request charges nothing (it is counted under a separate "denied" key for monitoring).
 */
const RESERVE_LUA = `
local site = tonumber(redis.call('GET', KEYS[1]) or '0')
local mine = tonumber(redis.call('GET', KEYS[2]) or '0')
local amount = tonumber(ARGV[1])
if site + amount > tonumber(ARGV[2]) or mine + amount > tonumber(ARGV[3]) then
  redis.call('INCR', KEYS[3]); redis.call('EXPIRE', KEYS[3], 172800)
  return 0
end
redis.call('INCRBY', KEYS[1], amount); redis.call('EXPIRE', KEYS[1], 172800)
redis.call('INCRBY', KEYS[2], amount); redis.call('EXPIRE', KEYS[2], 172800)
return 1`;

const localSpend = new Map<string, number>();
/**
 * Reserve `amount` units of a daily budget, site-wide and for this visitor, before spending them.
 * false = do not spend: over either budget, a budget of 0, Redis configured but failing, or no shared
 * ledger in production. Nothing is charged when the answer is false.
 */
export async function reserveDaily(name: string, visitorKey: string, amount: number, siteLimit: number, visitorLimit: number): Promise<boolean> {
  if (amount <= 0) return true;
  if (siteLimit <= 0 || visitorLimit <= 0) return false;
  const d = day();
  if (redis) {
    try {
      const ok = await redis.eval(RESERVE_LUA, [`mk:budget:${name}:${d}`, `mk:budget:${name}:${d}:${visitorKey}`, `mk:denied:${name}:${d}`], [
        String(amount),
        String(siteLimit),
        String(visitorLimit),
      ]);
      return Number(ok) === 1;
    } catch {
      return false; // fail closed: never spend paid quota without a working ledger
    }
  }
  if (!localLedgerAllowed()) return false;
  const siteKey = `${name}:${d}`;
  const mineKey = `${name}:${d}:${visitorKey}`;
  if (localSpend.size > 20000) localSpend.clear();
  const site = localSpend.get(siteKey) || 0;
  const mine = localSpend.get(mineKey) || 0;
  if (site + amount > siteLimit || mine + amount > visitorLimit) return false;
  localSpend.set(siteKey, site + amount);
  localSpend.set(mineKey, mine + amount);
  return true;
}

/** Reserve one real call to a distributor for this visitor (see reserveDaily). */
export function reserveSupplierCall(provider: Provider, visitorKey: string) {
  return reserveDaily(provider, visitorKey, 1, siteDaily(provider), visitorDaily());
}

/**
 * Machine-translation characters per day (Azure bills the characters actually sent). `visitorKey` null =
 * translation the server does on its own (part details, search results): only the site budget applies.
 */
export function reserveTranslation(visitorKey: string | null, chars: number) {
  const site = envBudget("TRANSLATE_DAILY_CHARS", 300_000);
  return reserveDaily("translate", visitorKey || "server", chars, site, visitorKey ? envBudget("TRANSLATE_VISITOR_DAILY_CHARS", 30_000) : site);
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

/**
 * Cached distributor answer: memory, then Redis, then `load`. Identical lookups are merged on this
 * instance (in-flight map) and across instances (a short Redis lock: the others wait for the cached
 * answer; if the holder dies the lock expires and one of them loads). Only successful answers are
 * cached; errors (429, auth, timeouts) are never stored as "no result".
 */
export async function supplierCached<T>(key: string, load: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return { value: hit.value as T, cached: true };
  const stored = await fromRedis<T>(key);
  if (stored !== null) {
    memo.set(key, { until: Date.now() + 60_000, value: stored });
    return { value: stored, cached: true };
  }
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return { value: await running, cached: true };
  const p = (async () => {
    let owner: string | null = null;
    if (redis) {
      const token = Math.random().toString(36).slice(2);
      try {
        const got = await redis.set(`${key}:lock`, token, { nx: true, px: 20_000 });
        if (got === "OK") owner = token;
        else
          for (let waited = 0; waited < 8_000; waited += 250) {
            await sleep(250);
            const v = await fromRedis<T>(key);
            if (v !== null) return v;
          }
      } catch {
        /* lock unavailable: load anyway (the paid budget still applies) */
      }
    }
    try {
      const value = await load();
      if (memo.size > 5000) memo.clear();
      memo.set(key, { until: Date.now() + TTL * 1000, value });
      if (redis) await redis.set(key, value as any, { ex: TTL }).catch(() => undefined);
      return value;
    } finally {
      if (redis && owner) await redis.eval(RELEASE_LUA, [`${key}:lock`], [owner]).catch(() => undefined);
    }
  })();
  inflight.set(key, p);
  try {
    return { value: await p, cached: false };
  } finally {
    inflight.delete(key);
  }
}

/** For routes outside the Maker catch-all: a 429 Response when over the bucket's rate, else null. */
export async function limitRoute(req: Request, bucket: Bucket): Promise<Response | null> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const { createHash } = await import("node:crypto");
  try {
    await limitRequest(createHash("sha256").update(ip).digest("hex").slice(0, 32), bucket);
    return null;
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Too many requests." }, { status: 429, headers: { "Retry-After": "60" } });
  }
}

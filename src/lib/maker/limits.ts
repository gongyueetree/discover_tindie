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
/** Site-wide calls per day (leave headroom under the account's real quota) and per visitor per day. */
const SITE_DAILY: Record<Provider, number> = {
  digikey: Number(process.env.DIGIKEY_DAILY_BUDGET) || 800,
  mouser: Number(process.env.MOUSER_DAILY_BUDGET) || 800,
};
const VISITOR_DAILY = Number(process.env.SUPPLIER_VISITOR_DAILY_BUDGET) || 150;

const localSpend = new Map<string, number>();
/**
 * Reserve `amount` units of a daily budget, site-wide and for this visitor, before spending them.
 * false = do not spend (over budget, or Redis configured but unreachable: fail closed).
 * Without Redis the budget is per server instance only.
 */
export async function reserveDaily(name: string, visitorKey: string, amount: number, siteLimit: number, visitorLimit: number): Promise<boolean> {
  const d = day();
  if (redis) {
    try {
      const siteKey = `mk:budget:${name}:${d}`;
      const mineKey = `mk:budget:${name}:${d}:${visitorKey}`;
      const site = await redis.incrby(siteKey, amount);
      if (site === amount) await redis.expire(siteKey, 2 * 86400);
      const mine = await redis.incrby(mineKey, amount);
      if (mine === amount) await redis.expire(mineKey, 2 * 86400);
      return site <= siteLimit && mine <= visitorLimit;
    } catch {
      return false; // fail closed: never spend paid quota without a working ledger
    }
  }
  const siteKey = `${name}:${d}`;
  const mineKey = `${name}:${d}:${visitorKey}`;
  if (localSpend.size > 20000) localSpend.clear();
  const site = (localSpend.get(siteKey) || 0) + amount;
  const mine = (localSpend.get(mineKey) || 0) + amount;
  localSpend.set(siteKey, site);
  localSpend.set(mineKey, mine);
  return site <= siteLimit && mine <= visitorLimit;
}

/** Reserve one real call to a distributor for this visitor (see reserveDaily). */
export function reserveSupplierCall(provider: Provider, visitorKey: string) {
  return reserveDaily(provider, visitorKey, 1, SITE_DAILY[provider], VISITOR_DAILY);
}

/** Machine-translation characters per day (Azure bills by character). */
export function reserveTranslation(visitorKey: string, chars: number) {
  return reserveDaily("translate", visitorKey, chars, Number(process.env.TRANSLATE_DAILY_CHARS) || 300_000, Number(process.env.TRANSLATE_VISITOR_DAILY_CHARS) || 30_000);
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
const TTL = Number(process.env.SUPPLIER_CACHE_SECONDS) || 3600;

/**
 * Cached distributor answer: memory, then Redis, then `load` (one call per key at a time on this
 * instance). Only successful answers are cached; errors (429, auth, timeouts) are not stored as "no result".
 */
export async function supplierCached<T>(key: string, load: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return { value: hit.value as T, cached: true };
  if (redis) {
    try {
      const v = await redis.get<T>(key);
      if (v !== null && v !== undefined) {
        memo.set(key, { until: Date.now() + 60_000, value: v });
        return { value: v, cached: true };
      }
    } catch {
      /* cache unavailable: load below */
    }
  }
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return { value: await running, cached: true };
  const p = load();
  inflight.set(key, p);
  try {
    const value = await p;
    if (memo.size > 5000) memo.clear();
    memo.set(key, { until: Date.now() + TTL * 1000, value });
    if (redis) void redis.set(key, value as any, { ex: TTL }).catch(() => undefined);
    return { value, cached: false };
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

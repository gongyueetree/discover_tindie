import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Edge-friendly, distributed rate limiting backed by Upstash Redis (works on
 * Vercel serverless — in-memory limiters don't, since each instance/cold-start
 * has its own memory).
 *
 * Configuration is read from env. Supports both the Upstash integration names
 * and the legacy Vercel KV names:
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL        / KV_REST_API_TOKEN
 *
 * FAILS OPEN: if Redis isn't configured, or a limiter call throws (backend
 * down), requests are allowed. Rate limiting is an availability-preserving
 * guard, not an auth gate — we never block legitimate traffic because the
 * limiter backend is unreachable.
 */

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const redis = url && token ? new Redis({ url, token }) : null;

export const rateLimitEnabled = redis !== null;

// One Ratelimit instance per (name, limit, window) — cached so we reuse the
// sliding-window state and don't rebuild on every request.
const limiters = new Map<string, Ratelimit>();

function getLimiter(name: string, limit: number, window: `${number} ${"s" | "m" | "h"}`): Ratelimit | null {
  if (!redis) return null;
  const key = `${name}:${limit}:${window}`;
  let rl = limiters.get(key);
  if (!rl) {
    rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix: `rl:${name}`,
      analytics: false,
    });
    limiters.set(key, rl);
  }
  return rl;
}

// Best-effort client IP from Vercel's forwarding headers.
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export type LimitOpts = {
  name: string;                                   // bucket name, e.g. "submit"
  limit: number;                                  // max requests per window
  window: `${number} ${"s" | "m" | "h"}`;         // e.g. "1 m", "10 s"
  identifier?: string;                            // override IP (e.g. email for login)
};

/** Returns a 429 NextResponse if the caller is over the limit, else null.
 *  Call at the top of a route handler:
 *    const limited = await enforceRateLimit(req, { name: "submit", limit: 5, window: "1 m" });
 *    if (limited) return limited;
 */
export async function enforceRateLimit(req: Request, opts: LimitOpts): Promise<NextResponse | null> {
  const rl = getLimiter(opts.name, opts.limit, opts.window);
  if (!rl) return null; // not configured -> fail open
  const id = opts.identifier || clientIp(req);
  try {
    const { success, limit, remaining, reset } = await rl.limit(id);
    if (success) return null;
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": String(remaining),
        },
      }
    );
  } catch {
    return null; // backend error -> fail open
  }
}

/** Lightweight boolean check (no NextResponse) for non-route callers such as
 *  the next-auth authorize() function. Returns true if the request is allowed. */
export async function checkRateLimit(identifier: string, opts: Omit<LimitOpts, "identifier">): Promise<boolean> {
  const rl = getLimiter(opts.name, opts.limit, opts.window);
  if (!rl) return true; // not configured -> allow
  try {
    const { success } = await rl.limit(identifier);
    return success;
  } catch {
    return true; // backend error -> allow
  }
}


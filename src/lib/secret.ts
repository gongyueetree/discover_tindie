import { timingSafeEqual } from "crypto";

/** Constant-time comparison of a request Bearer token against a configured
 *  secret. Returns false if the header is missing/malformed OR the secret is
 *  unset — callers therefore FAIL CLOSED when the env var isn't configured.
 *  Length is intentionally leaked (unavoidable), but the byte comparison is
 *  constant-time to avoid a timing oracle on the secret value. */
export function bearerMatches(authHeader: string | null, secret: string | undefined | null): boolean {
  if (!secret) return false;                       // fail closed: no secret => deny
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authHeader.slice(7));
  const expected = Buffer.from(`${secret}`);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}


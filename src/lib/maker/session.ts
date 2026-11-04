/**
 * Anonymous visitor session for the Maker tools (no sign-up): a random id signed with AUTH_SECRET,
 * kept in an http-only cookie for 30 days. It lets people behind one shared IP (school, office, maker
 * space) have their own allowances, while a looser per-IP allowance still applies on top — so
 * clearing cookies does not reset what a network can use, and a session cannot raise site budgets.
 *
 * Works in the Edge middleware (issues the cookie) and in Node route handlers (verifies it): Web Crypto.
 * Without AUTH_SECRET / MAKER_SESSION_SECRET no session is issued and everything falls back to the IP.
 */
export const SESSION_COOKIE = "mk_sid";

const secret = () => process.env.MAKER_SESSION_SECRET || process.env.AUTH_SECRET || "";
const b64url = (buf: ArrayBuffer) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function sign(id: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("mk-session:" + id)));
}

/** A new signed session value, or null when no secret is configured. */
export async function newSessionValue(): Promise<string | null> {
  if (!secret()) return null;
  const id = crypto.randomUUID().replace(/-/g, "");
  return `${id}.${await sign(id)}`;
}

/** The session id if the cookie value is ours (constant-time compare), else null. */
export async function verifySession(value: string | undefined | null): Promise<string | null> {
  if (!value || !secret()) return null;
  const m = value.match(/^([a-f0-9]{32})\.([A-Za-z0-9_-]{20,60})$/);
  if (!m) return null;
  const expected = await sign(m[1]);
  if (expected.length !== m[2].length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0 ? m[1] : null;
}

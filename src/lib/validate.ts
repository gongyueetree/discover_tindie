import { z } from "zod";

/* Shared input-hardening helpers for all write endpoints.
   Motivation: a 2026-08-13 probe hit /api/submit with SQLi strings, SSRF
   URLs (169.254.169.254, 127.0.0.1, gopher://, file://) and 5000-char
   fuzz payloads. Drizzle already parameterizes SQL; these helpers close
   the remaining gaps: unbounded lengths, control characters, and
   dangerous URL schemes that would become clickable links if approved. */

// Strip control characters (keep \n and \t for textareas), trim, cap length.
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

// Hosts that must never appear in stored URLs — link-local metadata
// services, loopback, and RFC1918 ranges. Nothing server-side fetches
// these URLs today, but they'd be one code change away from an SSRF.
const BLOCKED_HOST = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|metadata\.)/i;

/** Validate a user-supplied link. Returns the normalized URL string, or
 *  null if it isn't a plain public http(s) URL. Rejects javascript:,
 *  data:, file:, gopher: etc., embedded credentials, and private hosts. */
export function safeHttpUrl(v: unknown, max = 2048): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (BLOCKED_HOST.test(u.hostname)) return null;
  if (!u.hostname.includes(".")) return null; // bare hostnames like "intranet"
  return u.toString();
}

/** zod field: optional URL — absent stays undefined, empty string is kept
 *  (meaning "clear the field" on update), anything else must pass
 *  safeHttpUrl. Use for every user-editable link field. */
export const zUrlOptional = z
  .string().max(2048).optional()
  .transform((v) => (v === undefined ? undefined : v.trim()))
  .refine((v) => v === undefined || v === "" || safeHttpUrl(v) !== null, {
    message: "must be a public http(s) URL",
  });

/** zod field: bounded, control-char-free text. */
export const zText = (max: number, min = 0) =>
  z.string().max(max * 2).transform((v) => cleanText(v, max)).refine((v) => v.length >= min, {
    message: min > 0 ? "required" : undefined,
  });

/** zod field: bounded array of short tag strings. */
export const zTags = (maxItems: number, maxLen = 40) =>
  z.array(z.string().max(maxLen * 2)).max(maxItems)
    .transform((a) => a.map((t) => cleanText(t, maxLen)).filter(Boolean));

/** ISO datetime string or null (for schedule fields). */
export const zIsoDateOrNull = z
  .string().max(40).nullable().optional()
  .refine((v) => v == null || !Number.isNaN(new Date(v).getTime()), { message: "invalid date" });


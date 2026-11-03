/**
 * Who sees the new Discover tabs (Components, Open hardware, PCB planner) while they are being
 * tested. Edge-safe: used by the middleware and by server pages.
 *
 * - MAKER_TOOLS_PUBLIC=1 → everyone (go-live switch, set in Vercel when ready).
 * - Otherwise only a signed-in admin / editor, or a browser that opened
 *   /tools/preview?key=<MAKER_PREVIEW_KEY> (sets an HttpOnly cookie for 30 days).
 * Everybody else sees the original Discover page without the tab bar, and the tools' pages and
 * APIs answer as if they did not exist.
 */
export const PREVIEW_COOKIE = "tindie_tools_preview";

export function toolsPublic() {
  return process.env.MAKER_TOOLS_PUBLIC === "1";
}

function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function previewKeyMatches(value: string | undefined | null) {
  const key = process.env.MAKER_PREVIEW_KEY || "";
  return key.length >= 16 && !!value && sameString(value, key);
}

export function toolsAllowed(role: string | undefined | null, previewCookie: string | undefined | null) {
  if (toolsPublic()) return true;
  if (role === "admin" || role === "editor") return true;
  return previewKeyMatches(previewCookie);
}

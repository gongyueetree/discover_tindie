// Client-safe URL scheme guard (no zod import, so it stays out of nothing —
// safe to bundle into client components). Use when rendering a user/DB-derived
// value as an href: returns the URL only if it is a plain http(s) (or safe
// relative) link, else null — blocking javascript:/data:/vbscript: etc.
export function safeLinkHref(raw: string | null | undefined): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s, "https://x.invalid"); // base resolves relative links
    if (u.protocol === "http:" || u.protocol === "https:") return s;
  } catch { /* invalid URL */ }
  return null;
}


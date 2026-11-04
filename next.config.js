/** @type {import('next').NextConfig} */

// Applied to every route. frame-ancestors keeps the site embeddable on
// tindie.com (the app is served in an iframe there) while blocking every
// other origin — closes clickjacking on /login and /admin. We intentionally
// do NOT set a script-src CSP here: Next.js injects inline hydration scripts,
// and a strict policy would break the app without a nonce pipeline.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://*.tindie.com https://tindie.com" },
];

const nextConfig = {
  reactStrictMode: true,
  // Keep the Node 'postgres' driver out of the server bundle so it doesn't
  // try to resolve its cloudflare:/node: variants. Loaded at runtime instead.
  serverExternalPackages: ["postgres", "bcryptjs"],
  async headers() {
    return [
      {
        // Global security headers (incl. scoped frame-ancestors for embedding).
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Home page is dynamic — never let the CDN cache it, so newly published
        // discoveries and edits show immediately (the /embed copy stays cached).
        source: "/",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
      {
        // Same for the archive and directory (always reflect latest data).
        source: "/archive",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
      {
        // PWA: the service worker must never be cached long-term, or users
        // won't pick up new versions. Browsers revalidate on every load.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // PWA: short cache for the manifest.
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};
export default nextConfig;


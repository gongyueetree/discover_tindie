// public/sw.js
// Tindie Resources Service Worker (hand-written, no build step)
// Bump CACHE_VERSION on every meaningful change to force clients to update.

const CACHE_VERSION = 'tindie-v1';
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const PRECACHE = `${CACHE_VERSION}-precache`;

// Minimal app shell. Keep this list small — Next.js hashes most assets,
// so we rely on runtime caching for those.
const PRECACHE_URLS = [
  '/',
  '/offline',
  '/manifest.json',
];

// ---- Install: pre-cache the shell ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Activate this SW immediately on next load
  self.skipWaiting();
});

// ---- Activate: clean up old caches ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ---- Fetch strategy ----
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET; let the browser deal with POST/PUT/etc.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache cross-origin API calls or the Next.js data/HMR endpoints
  if (url.origin !== self.location.origin) return;

  // Never cache API routes, admin, auth, or cron — always go to network.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/login')
  ) {
    return;
  }

  // HTML navigations: network-first, fall back to cache, then /offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match('/offline');
        })
    );
    return;
  }

  // Static assets (JS/CSS/img/fonts/logos): stale-while-revalidate.
  if (
    url.pathname.startsWith('/_next/') ||
    url.pathname.startsWith('/logos/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:js|css|png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});

// ---- Allow the page to trigger an immediate update ----
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});


// Pluto service worker: caches the static app shell only. Bump this constant
// on any shell change so clients pick up the new assets and drop the old
// cache.
const CACHE_VERSION = "pluto-shell-v1";

// Exactly what gets cached: the start page and the PWA icons/manifest. Never
// add API routes, `/notes/*` (PDF pages), `/open/*`, `/login`, or anything
// that can carry a session or another student's data — a stale or
// cross-student cached response here would be a security bug.
const APP_SHELL_URLS = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isAppShellAsset(url) {
  return APP_SHELL_URLS.includes(url.pathname) || url.pathname.startsWith("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever intervene for same-origin GETs to the fixed app-shell asset
  // list above. Everything else (pages, `/api/*`, `/notes/*`, `/open/*`,
  // auth) is left to the network exactly as if this service worker did not
  // exist: no caching, no interception, no stale or cross-student data.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!isAppShellAsset(url)) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw new Error("Network request failed and no cached app-shell asset was found");
      }
    }),
  );
});

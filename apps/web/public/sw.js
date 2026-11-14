// Pluto service worker. Caches static assets only. Bump CACHE_VERSION whenever
// this file changes so activate() drops every previous cache, including
// pluto-shell-v1 (which stored `/`) and pluto-shell-v2.
export const CACHE_VERSION = "pluto-static-v2";
export const PLUTO_CACHE_PREFIX = "pluto-";
export const CLEAR_CACHES_TYPE = "CLEAR_CACHES";
export const OFFLINE_URL = "/offline.html";

// No authenticated document lives here. `/` renders the student's name and
// must never be precached. `/_next/static/*` is filled in from fetch, not
// listed, because those URLs include build hashes. `/offline.html` is a
// static page with no user data, used only when a navigation fails offline.
export const PRECACHE_URLS = [OFFLINE_URL, "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

const OFFLINE_FALLBACK_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pluto</title></head>
<body><main><h1>You're offline</h1><p>Pluto needs a connection to show this page. Reconnect and try again.</p></main></body>
</html>`;

export function hasRscHeader(headers) {
  if (!headers || typeof headers.get !== "function") return false;
  return (
    headers.get("RSC") !== null ||
    headers.get("Next-Router-Prefetch") !== null ||
    headers.get("Next-Router-Segment-Prefetch") !== null
  );
}

export function isStaticAssetPath(pathname) {
  if (pathname.startsWith("/_next/static/")) return true;
  return PRECACHE_URLS.includes(pathname);
}

/**
 * True only for a same-origin GET of a static asset with no query string and
 * no Next.js RSC/prefetch header. Navigations are never cacheable: `/` and
 * every other authenticated page stay on the network.
 */
export function shouldCacheRequest(url, request, workerOrigin) {
  if (!request || request.method !== "GET") return false;
  if (workerOrigin && url.origin !== workerOrigin) return false;
  if (request.mode === "navigate") return false;
  if (url.search) return false;
  if (hasRscHeader(request.headers)) return false;
  return isStaticAssetPath(url.pathname);
}

export function plutoCacheNames(keys) {
  return keys.filter((key) => key.startsWith(PLUTO_CACHE_PREFIX));
}

function inServiceWorker() {
  return typeof self !== "undefined" && typeof self.skipWaiting === "function";
}

async function precacheStatic() {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(PRECACHE_URLS);
}

async function deletePlutoCaches() {
  const keys = await caches.keys();
  await Promise.all(plutoCacheNames(keys).map((key) => caches.delete(key)));
}

async function networkFirstStatic(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function networkWithOfflineFallback(request) {
  try {
    // Navigations are returned as-is and never written to Cache Storage.
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(OFFLINE_URL);
    if (cached) return cached;
    return new Response(OFFLINE_FALLBACK_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

function registerServiceWorker() {
  if (!inServiceWorker()) return;

  self.addEventListener("install", (event) => {
    event.waitUntil(precacheStatic().then(() => self.skipWaiting()));
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
        .then(() => self.clients.claim()),
    );
  });

  self.addEventListener("message", (event) => {
    if (!event.data || event.data.type !== CLEAR_CACHES_TYPE) return;
    event.waitUntil(deletePlutoCaches().then(() => precacheStatic()));
  });

  self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Document loads (including `/` and `/?_rsc` full reloads) are network-only.
    // A failed navigation gets the static offline page, which has no user data.
    if (request.mode === "navigate") {
      event.respondWith(networkWithOfflineFallback(request));
      return;
    }

    if (!shouldCacheRequest(url, request, self.location.origin)) return;

    event.respondWith(networkFirstStatic(request));
  });
}

registerServiceWorker();

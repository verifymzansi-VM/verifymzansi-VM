/// <reference lib="webworker" />

/**
 * VerifyMzansi Service Worker — offline support & caching strategy.
 *
 * Strategy:
 *  - Static assets (JS, CSS, images): Cache-first with long TTL
 *  - HTML pages: Network-first with offline fallback
 *  - API calls: Network-only (no caching of dynamic data)
 */

const CACHE_NAME = "verifymzansi-v3-logo-refresh";
const OFFLINE_URL = "/offline";

const PRECACHE_URLS = ["/", "/offline", "/manifest.json"];

// @ts-ignore - ServiceWorkerGlobalScope

// ── Install: precache critical assets ────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: route requests to the right strategy ─────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, API routes, and cross-origin
  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.origin !== self.location.origin) return;

  // Static assets — cache-first
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/images/")
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML pages — network-first with offline fallback
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirstWithOffline(request));
    return;
  }

  // Everything else — network-first
  event.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response("Offline", { status: 503 });
  }
}

async function networkFirstWithOffline(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Fallback to offline page
    const offlinePage = await caches.match(OFFLINE_URL);
    return (
      offlinePage ??
      new Response(
        "<html><body><h1>You are offline</h1><p>Please check your connection.</p></body></html>",
        { headers: { "Content-Type": "text/html" } }
      )
    );
  }
}

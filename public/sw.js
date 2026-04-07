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

const DEFAULT_NOTIFICATION_ICON = "/icons/icon-192.png?v=10";
const DEFAULT_NOTIFICATION_TAG = "verifymzansi-notification";

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
// Protected route prefixes — never cache their HTML to avoid serving
// stale auth-dependent content (common cause of post-login errors on mobile).
const PROTECTED_PREFIXES = ["/dashboard", "/post", "/billing", "/verification", "/admin"];

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
    // Never cache protected (auth-dependent) pages — serve network-only
    // with an offline fallback so stale cached HTML can't cause errors.
    const isProtected = PROTECTED_PREFIXES.some((p) => url.pathname.startsWith(p));
    if (isProtected) {
      event.respondWith(networkOnlyWithOffline(request));
      return;
    }
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

async function networkOnlyWithOffline(request) {
  try {
    return await fetch(request);
  } catch {
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

// ── Push notifications: show alerts when app is backgrounded/offline ──
self.addEventListener("push", (event) => {
  let payload = {
    title: "VerifyMzansi",
    body: "You have a new update.",
    url: "/dashboard",
    icon: DEFAULT_NOTIFICATION_ICON,
    tag: DEFAULT_NOTIFICATION_TAG,
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title:
          typeof parsed?.title === "string" && parsed.title.length > 0
            ? parsed.title
            : payload.title,
        body:
          typeof parsed?.body === "string" && parsed.body.length > 0 ? parsed.body : payload.body,
        url: typeof parsed?.url === "string" && parsed.url.startsWith("/") ? parsed.url : payload.url,
        icon:
          typeof parsed?.icon === "string" && parsed.icon.length > 0
            ? parsed.icon
            : payload.icon,
        tag:
          typeof parsed?.tag === "string" && parsed.tag.length > 0 ? parsed.tag : payload.tag,
      };
    } catch {
      // Fall back to defaults if the payload isn't valid JSON.
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      tag: payload.tag,
      data: { url: payload.url },
      renotify: true,
    })
  );
});

// ── Notification click: focus/open the target route ───────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetPath =
    event.notification?.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const targetUrl = new URL(targetPath, self.location.origin).href;

        for (const client of clients) {
          if (client.url === targetUrl && "focus" in client) {
            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetPath);
        }

        return undefined;
      })
  );
});

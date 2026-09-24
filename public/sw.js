/// <reference lib="webworker" />

/**
 * VerifyMzansi Service Worker — offline support & caching strategy.
 *
 * Strategy:
 *  - Next.js build assets: Network-only (hashed chunks must never be stale)
 *  - Public images/icons: Revalidate online, cached fallback offline
 *  - HTML pages: Network-only with offline fallback
 *  - API calls: Network-only (no caching of dynamic data)
 */

const CACHE_NAME = "verifymzansi-v8-brand-shield-cache";
const OFFLINE_URL = "/offline";

const PRECACHE_URLS = ["/offline", "/manifest.json", "/icons/icon-192.png?v=20260924"];

const DEFAULT_NOTIFICATION_ICON = "/icons/icon-192.png?v=20260924";
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
        Promise.all(
          keys
            .filter((key) => key.startsWith("verifymzansi-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
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
  if (url.origin !== self.location.origin) return;

  // Let the HTTP cache handle media, including Range requests. Cache Storage
  // ignores Range when matching and can return an entire cached video instead
  // of the requested segment. It also bypasses expiry and access-control headers.
  if (url.pathname.startsWith("/api/")) return;

  // Next.js build assets are content-hashed and deployment-scoped. Serving an
  // older HTML shell or stale chunk from the service worker can make Safari
  // request deleted files after a deploy ("Loading chunk ... failed").
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(networkOnly(request));
    return;
  }

  // Public static assets — cache-first
  if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/images/")) {
    event.respondWith(networkFirst(request, event));
    return;
  }

  // HTML pages — network-only with offline fallback. Do not cache app shells:
  // old HTML can reference Next chunks that no longer exist after deploy.
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkOnlyWithOffline(request));
    return;
  }

  // Do not persist RSC navigation/prefetch payloads or other dynamic responses.
  // The browser and server own their caching policy.
});

async function networkFirst(request, event) {
  try {
    // Respect the HTTP cache (images ship long-lived Cache-Control headers and
    // versioned query strings) so repeat mobile visits render instantly instead
    // of revalidating every image on every load. Cache Storage remains the
    // offline fallback only.
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      // Persist in the background so image rendering never waits for a full
      // cache write. Quota/private-mode errors must not discard a fresh response.
      event.waitUntil(
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(request, copy))
          .catch(() => {})
      );
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response("Offline", { status: 503 });
  }
}

async function networkOnly(request) {
  return fetch(request);
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
        url:
          typeof parsed?.url === "string" && parsed.url.startsWith("/") ? parsed.url : payload.url,
        icon:
          typeof parsed?.icon === "string" && parsed.icon.length > 0 ? parsed.icon : payload.icon,
        tag: typeof parsed?.tag === "string" && parsed.tag.length > 0 ? parsed.tag : payload.tag,
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
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
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

/**
 * Client-side commercial analytics: impressions and contact actions are queued
 * and flushed in small batches with sendBeacon. Aggregates only — the server
 * stores a hashed viewer key and never exposes it to organisations.
 */
export const COMMERCIAL_EVENT_TYPES = [
  "impression",
  "detail_view",
  "whatsapp_click",
  "phone_click",
  "website_click",
  "share",
  "save",
  "search_appearance",
  "homepage_appearance",
  "showroom_appearance",
  "organisation_directory_appearance",
] as const;

export type CommercialEventType = (typeof COMMERCIAL_EVENT_TYPES)[number];
export type CommercialEventTable = "listings" | "businesses" | "promotions" | "organisations";

export interface CommercialEvent {
  table: CommercialEventTable;
  id: string;
  type: CommercialEventType;
  surface?: string;
  source?: string;
}

const ENDPOINT = "/api/analytics/events";
const MAX_BATCH = 50;
let queue: CommercialEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function trafficSource(): string | undefined {
  if (typeof document === "undefined" || !document.referrer) return undefined;
  try {
    const host = new URL(document.referrer).hostname;
    if (host === window.location.hostname) return "internal";
    if (/google|bing|duckduckgo|yahoo/.test(host)) return "search";
    if (/facebook|instagram|tiktok|twitter|x\.com|linkedin|whatsapp/.test(host)) return "social";
    return "referral";
  } catch {
    return undefined;
  }
}

function send(events: CommercialEvent[]) {
  if (events.length === 0) return;
  const body = JSON.stringify({ events });
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon(ENDPOINT, blob)) return;
  }
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Analytics must never interrupt browsing.
  });
}

export function flushCommercialEvents() {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length > 0) send(queue.splice(0, MAX_BATCH));
}

/** Queue events; flushed after a short delay, on page hide, or when full. */
export function trackCommercialEvents(events: CommercialEvent[]) {
  if (typeof window === "undefined") return;
  if (typeof navigator !== "undefined" && navigator.doNotTrack === "1") return;
  const source = trafficSource();
  queue.push(...events.map((event) => ({ source, ...event })));
  if (!listening) {
    listening = true;
    window.addEventListener("pagehide", flushCommercialEvents);
  }
  if (queue.length >= MAX_BATCH) {
    flushCommercialEvents();
    return;
  }
  if (!timer) timer = setTimeout(flushCommercialEvents, 2000);
}

/** Contact actions (WhatsApp, phone, website) are sent immediately. */
export function trackContactAction(
  table: CommercialEventTable,
  id: string | null | undefined,
  type: Extract<
    CommercialEventType,
    "whatsapp_click" | "phone_click" | "website_click" | "share" | "save"
  >,
  surface?: string
) {
  if (!id) return;
  trackCommercialEvents([{ table, id, type, surface }]);
  flushCommercialEvents();
}

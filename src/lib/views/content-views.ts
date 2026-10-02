/**
 * Client side of the content view counter (views v2).
 *
 * A view is counted the way social platforms and the MRC/IAB video standard
 * count it: the video played for 2 continuous seconds with at least half of
 * the player on screen, or the post's own page was opened. Every page that
 * shows a post (showrooms, home rows, grids, detail pages, full-screen
 * viewer) reports through this one queue. The server counts one view per
 * person, per post, per 30 minutes and is the source of truth; this module
 * only avoids sending what it already sent.
 */

import type { ContentTargetType } from "@/lib/engagement";

export type ViewSource = "video" | "page";

export interface ContentViewEvent {
  type: ContentTargetType;
  id: string;
  source: ViewSource;
  /** Where the post was seen, e.g. "showroom:home", "grid:market", "detail". */
  surface?: string;
  /** 30 seconds, or 90% of a shorter video: the stricter "engaged" view. */
  engaged?: boolean;
}

/** Same window the server uses: one view per person per post per 30 minutes. */
export const VIEW_WINDOW_MS = 30 * 60 * 1000;
export const VIEW_RECORDED_EVENT = "vmz:content-view-recorded";

const ENDPOINT = "/api/engagement/view";
const MAX_BATCH = 20;
const FLUSH_DELAY_MS = 1000;

interface Pending {
  event: ContentViewEvent;
  resolve: (counted: boolean) => void;
  /** The marker before this event, restored if sending fails. */
  previous: SentMarker | null;
}

interface SentMarker {
  at: number;
  engaged: boolean;
}

let queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
const memoryMarkers = new Map<string, SentMarker>();

function markerKey(event: ContentViewEvent) {
  return `vmz:view:${event.type}:${event.id}`;
}

function readMarker(key: string, now: number): SentMarker | null {
  let marker = memoryMarkers.get(key) ?? null;
  try {
    const stored = localStorage.getItem(key);
    if (stored) marker = JSON.parse(stored) as SentMarker;
  } catch {
    // Storage can be blocked (private mode); memory still dedupes this page.
  }
  if (
    !marker ||
    !Number.isFinite(marker.at) ||
    now - marker.at >= VIEW_WINDOW_MS ||
    now < marker.at
  ) {
    return null;
  }
  return marker;
}

function writeMarker(key: string, marker: SentMarker) {
  memoryMarkers.set(key, marker);
  try {
    localStorage.setItem(key, JSON.stringify(marker));
  } catch {
    // Memory marker above is enough for this page.
  }
}

function forgetMarker(key: string, previous: SentMarker | null) {
  if (previous) writeMarker(key, previous);
  else {
    memoryMarkers.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing stored.
    }
  }
}

function announce(event: ContentViewEvent) {
  window.dispatchEvent(
    new CustomEvent(VIEW_RECORDED_EVENT, { detail: { targetId: event.id, targetType: event.type } })
  );
}

async function send(batch: Pending[], useBeacon: boolean) {
  if (batch.length === 0) return;
  const body = JSON.stringify({ events: batch.map((pending) => pending.event) });

  if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    // The page is going away: deliver the views, nobody is left to update.
    const sent = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    batch.forEach((pending) => pending.resolve(false));
    if (sent) return;
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
    if (!response.ok) throw new Error(`View request failed: ${response.status}`);
    const payload = (await response.json().catch(() => null)) as { counted?: string[] } | null;
    // The server lists each post it counted as a new view once; credit it to
    // the first event for that post so the page number moves by exactly one.
    const counted = new Set(payload?.counted ?? []);
    for (const pending of batch) {
      const wasCounted = counted.delete(pending.event.id);
      if (wasCounted) announce(pending.event);
      pending.resolve(wasCounted);
    }
  } catch {
    // Let a later play or page open retry; never block browsing.
    for (const pending of batch) {
      forgetMarker(markerKey(pending.event), pending.previous);
      pending.resolve(false);
    }
  }
}

function flush(useBeacon = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length > 0) void send(queue.splice(0, MAX_BATCH), useBeacon);
}

/**
 * Queue a view. Resolves true when the server counted it as a new view, so a
 * page can bump the number it shows. Duplicates inside the 30-minute window
 * are dropped here and resolve false.
 */
export function trackContentView(event: ContentViewEvent): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);

  const key = markerKey(event);
  const now = Date.now();
  const previous = readMarker(key, now);
  // A plain view is already counted; an engaged signal is sent once.
  if (previous && (!event.engaged || previous.engaged)) return Promise.resolve(false);
  writeMarker(key, {
    at: previous?.at ?? now,
    engaged: Boolean(event.engaged || previous?.engaged),
  });

  return new Promise((resolve) => {
    queue.push({ event, resolve, previous });
    if (!listening) {
      listening = true;
      window.addEventListener("pagehide", () => flush(true));
    }
    if (queue.length >= MAX_BATCH) flush();
    else if (!timer) timer = setTimeout(() => flush(), FLUSH_DELAY_MS);
  });
}

/** Test helper: drop queued events and markers. */
export function resetContentViewQueueForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
  queue = [];
  memoryMarkers.clear();
}

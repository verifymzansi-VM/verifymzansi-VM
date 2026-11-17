/**
 * Shared browser reads of the signed-in member's inbox.
 *
 * Several parts of a page show the same inbox data: the header bell (one for
 * desktop and one for phones, both mounted), the live toasts, the dashboard's
 * lead badge and lead alerts. Each used to fetch on mount, on every realtime
 * signal and on its own timer, so one page load sent the same request about
 * five times at once. Here callers of the same read share one request, and
 * each refresh timer is shared by everyone who wants it.
 *
 * - A caller without `fresh` (first load, a timer tick) joins the request
 *   already in flight.
 * - A `fresh` caller (a realtime signal that something changed, or a check
 *   after a failed update) must not get data read before it asked: if a
 *   request is already in flight it gets one more read that starts when that
 *   request settles, shared with every other fresh caller meanwhile.
 * - Nothing is kept after a request settles, and a request that takes longer
 *   than READ_TIMEOUT_MS is cancelled, so one stuck request never blocks later
 *   refreshes.
 */

export const NOTIFICATION_FEED_URL = "/api/notifications?limit=25";
export const LEADS_UNREAD_URL = "/api/leads?countOnly=true";
export const READ_TIMEOUT_MS = 15_000;

export interface SharedReadResult {
  ok: boolean;
  status: number;
  /** The parsed JSON body of a successful response; null otherwise. */
  data: unknown;
}

type Read = { request: Promise<SharedReadResult>; after?: Promise<SharedReadResult> };
const inFlight = new Map<string, Read>();

function startRead(url: string): Read {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  const read: Read = {
    request: (async (): Promise<SharedReadResult> => {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) return { ok: false, status: response.status, data: null };
      const data: unknown = await response.json().catch(() => null);
      return { ok: data !== null, status: response.status, data };
    })().finally(() => {
      clearTimeout(timer);
      if (inFlight.get(url) === read) inFlight.delete(url);
    }),
  };
  inFlight.set(url, read);
  return read;
}

/** GET `url` as JSON, shared with other callers of the same URL (see above). */
export function sharedInboxRead(
  url: string,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<SharedReadResult> {
  const current = inFlight.get(url);
  if (!current) return startRead(url).request;
  if (!fresh) return current.request;
  current.after ??= current.request.then(
    () => sharedInboxRead(url),
    () => sharedInboxRead(url)
  );
  return current.after;
}

type Poll = { listeners: Set<() => void>; stop: () => void };
const polls = new Map<string, Poll>();

/**
 * Run `listener` every `intervalMs` while the tab is visible, and when the tab
 * becomes visible or focused again. Everyone polling the same `key` shares one
 * timer and one pair of window listeners. Returns the unsubscribe function.
 */
export function subscribeSharedPoll(
  key: string,
  intervalMs: number,
  listener: () => void
): () => void {
  let poll = polls.get(key);
  if (!poll) {
    const listeners = new Set<() => void>();
    const runIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      for (const run of [...listeners]) run();
    };
    const timer = window.setInterval(runIfVisible, intervalMs);
    window.addEventListener("focus", runIfVisible);
    document.addEventListener("visibilitychange", runIfVisible);
    poll = {
      listeners,
      stop: () => {
        window.clearInterval(timer);
        window.removeEventListener("focus", runIfVisible);
        document.removeEventListener("visibilitychange", runIfVisible);
      },
    };
    polls.set(key, poll);
  }
  const entry = poll;
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && polls.get(key) === entry) {
      entry.stop();
      polls.delete(key);
    }
  };
}

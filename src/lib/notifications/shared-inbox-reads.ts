/**
 * Shared browser reads of the signed-in member's inbox.
 *
 * Several parts of a page show the same inbox data: the header bell (one for
 * desktop and one for phones, both mounted), the live toasts, the dashboard's
 * lead badge and lead alerts. Each used to fetch on mount, on every realtime
 * signal and on its own timer, so one page load sent the same request about
 * five times at once. Here every caller of the same read joins the one request
 * already in flight, and each refresh timer is shared by everyone who wants it.
 *
 * Nothing is kept after a request settles: a caller that arrives later starts
 * a fresh read, so a realtime signal never gets an answer older than itself
 * unless a read was already on its way.
 */

export const NOTIFICATION_FEED_URL = "/api/notifications?limit=25";
export const LEADS_UNREAD_URL = "/api/leads?countOnly=true";

export interface SharedReadResult {
  ok: boolean;
  status: number;
  /** The parsed JSON body of a successful response; null otherwise. */
  data: unknown;
}

const inFlight = new Map<string, Promise<SharedReadResult>>();

/** GET `url` as JSON, sharing the request already in flight for the same URL. */
export function sharedInboxRead(url: string): Promise<SharedReadResult> {
  const current = inFlight.get(url);
  if (current) return current;
  const request = (async (): Promise<SharedReadResult> => {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return { ok: false, status: response.status, data: null };
    const data: unknown = await response.json().catch(() => null);
    return { ok: data !== null, status: response.status, data };
  })().finally(() => {
    if (inFlight.get(url) === request) inFlight.delete(url);
  });
  inFlight.set(url, request);
  return request;
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

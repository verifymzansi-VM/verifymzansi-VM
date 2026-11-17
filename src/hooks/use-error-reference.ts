"use client";

import { useSyncExternalStore } from "react";
import { isRequestReference, REFERENCE_TIMING_NAME } from "@/lib/utils/request-reference";

const withoutHash = (url: string) => url.split("#", 1)[0];
// Browsers keep 250 resource entries by default and then stop adding them, so a
// full buffer can no longer prove that nothing happened since the page loaded.
const RESOURCE_BUFFER_LIMIT = 250;

/**
 * True when the page has fetched from its own pages since it loaded: a client
 * navigation, a refresh or a server action. API calls and static files are not
 * page requests. Link prefetches count too, which only makes this cautious.
 */
function pageFetchedSinceLoad(): boolean {
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  if (resources.length >= RESOURCE_BUFFER_LIMIT) return true;
  return resources.some((entry) => {
    if (entry.initiatorType !== "fetch" && entry.initiatorType !== "xmlhttprequest") return false;
    let url: URL;
    try {
      url = new URL(entry.name);
    } catch {
      return true;
    }
    if (url.origin !== window.location.origin) return false;
    return !/^\/(?:api|_next|cdn-cgi)\//.test(url.pathname);
  });
}

/**
 * The Cloudflare request reference of the page load, only while the error can
 * only have come from that load: the page is still the one the browser loaded
 * and no client navigation, refresh or server action has happened since. The
 * proxy sends it in a Server-Timing entry; nothing else is read.
 */
function readPageReference(): string | null {
  try {
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (!entry || withoutHash(entry.name) !== withoutHash(window.location.href)) return null;
    if (pageFetchedSinceLoad()) return null;
    const value = entry.serverTiming?.find(
      (timing) => timing.name === REFERENCE_TIMING_NAME
    )?.description;
    return isRequestReference(value) ? value : null;
  } catch {
    // Older browsers without timing entries fall back to the error digest.
    return null;
  }
}

// Decided once per error, when it is first shown, so later prefetches or
// re-renders never switch the reference that is already on screen.
const decided = new WeakMap<object, string | null>();
const subscribe = () => () => undefined;

/**
 * The reference an error page shows for a server error: the page load's request
 * reference when the error came from that load (it matches the server log
 * line), else the error digest (also in that log line). Client-only errors have
 * neither.
 */
export function useErrorReference(error: { digest?: string }): string | undefined {
  const pageReference = useSyncExternalStore(
    subscribe,
    () => {
      if (!decided.has(error)) decided.set(error, readPageReference());
      return decided.get(error) ?? null;
    },
    () => null
  );
  if (!error.digest) return undefined;
  return pageReference ?? error.digest;
}

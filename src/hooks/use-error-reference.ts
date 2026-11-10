"use client";

import { useSyncExternalStore } from "react";
import { isRequestReference, REFERENCE_TIMING_NAME } from "@/lib/utils/request-reference";

const withoutHash = (url: string) => url.split("#", 1)[0];

/**
 * The Cloudflare request reference of the page load, when the current page is
 * the one the browser loaded (no client-side navigation since). The proxy
 * sends it in a Server-Timing entry; nothing else is read.
 */
function readPageReference(): string | null {
  try {
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (!entry || withoutHash(entry.name) !== withoutHash(window.location.href)) return null;
    const value = entry.serverTiming?.find(
      (timing) => timing.name === REFERENCE_TIMING_NAME
    )?.description;
    return isRequestReference(value) ? value : null;
  } catch {
    // Older browsers without timing entries fall back to the error digest.
    return null;
  }
}

const subscribe = () => () => undefined;

/**
 * The reference an error page shows for a server error: the request reference
 * when the failing request is known (it matches the server log line), else
 * the error digest (also in that log line). Client-only errors have neither.
 */
export function useErrorReference(error: { digest?: string }): string | undefined {
  const pageReference = useSyncExternalStore(subscribe, readPageReference, () => null);
  if (!error.digest) return undefined;
  return pageReference ?? error.digest;
}

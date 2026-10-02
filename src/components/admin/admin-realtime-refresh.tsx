"use client";

import { startTransition, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/hooks/use-realtime";

const REFRESH_DEBOUNCE_MS = 400;
/**
 * With many staff online, every refresh re-runs the layout and page reads for
 * each of them. Events arriving faster than this are merged into one refresh.
 */
const MIN_REFRESH_INTERVAL_MS = 10_000;
const FALLBACK_REFRESH_MS = 120_000;
const FOCUS_REFRESH_STALE_MS = 30_000;

type RealtimePayload = Record<string, unknown> & {
  new?: Record<string, unknown> | null;
};

/**
 * Keeps an open admin page current. Live events come from the viewer's own
 * staff notifications only: the queue tables are deliberately not in the
 * realtime publication, so their rows (ID checks, data requests) are never
 * broadcast. Everything else is caught by the focus and fallback refreshes.
 */
export function AdminRealtimeRefresh({ userId }: { userId: string }) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAtRef = useRef(0);

  const refresh = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    lastRefreshAtRef.current = Date.now();
    startTransition(() => router.refresh());
  }, [router]);

  const scheduleRefresh = () => {
    // One refresh is already due: this event will be included in it.
    if (timeoutRef.current) return;
    const wait = Math.max(
      REFRESH_DEBOUNCE_MS,
      lastRefreshAtRef.current + MIN_REFRESH_INTERVAL_MS - Date.now()
    );
    timeoutRef.current = setTimeout(refresh, wait);
  };

  useEffect(() => {
    lastRefreshAtRef.current = Date.now();
    // Recover missed events without reloading every admin query on every focus.
    const refreshIfStale = (minAgeMs: number) => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefreshAtRef.current >= minAgeMs
      ) {
        refresh();
      }
    };
    const refreshOnFocus = () => refreshIfStale(FOCUS_REFRESH_STALE_MS);
    const interval = setInterval(() => refreshIfStale(FALLBACK_REFRESH_MS), FALLBACK_REFRESH_MS);
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [refresh]);

  // Filtered to the viewer, so the server checks only their rows, not every user's.
  useRealtime({
    table: "notifications",
    event: "INSERT",
    filterColumn: "user_id",
    filterValue: userId,
    onEvent: (payload) => {
      const href = (payload as RealtimePayload).new?.href;
      if (typeof href === "string" && href.startsWith("/admin")) {
        scheduleRefresh();
      }
    },
  });

  return null;
}

"use client";

import { startTransition, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/hooks/use-realtime";

const REFRESH_DEBOUNCE_MS = 400;
const FALLBACK_REFRESH_MS = 120_000;
const FOCUS_REFRESH_STALE_MS = 30_000;
const DSAR_ACTIVE_STATUSES = new Set(["submitted", "in_progress"]);

type RealtimePayload = Record<string, unknown> & {
  eventType?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
};

function readStatus(record: Record<string, unknown> | null | undefined): string | null {
  return typeof record?.status === "string" ? record.status : null;
}

function isQueueEntry(payload: RealtimePayload, activeStatuses: ReadonlySet<string>) {
  const nextStatus = readStatus(payload.new);
  if (!nextStatus || !activeStatuses.has(nextStatus)) {
    return false;
  }

  if (payload.eventType === "INSERT") {
    return true;
  }

  const previousStatus = readStatus(payload.old);
  return previousStatus !== nextStatus;
}

function isVerificationQueueEntry(payload: RealtimePayload) {
  return isQueueEntry(payload, new Set(["pending"]));
}

function isModerationQueueEntry(payload: RealtimePayload) {
  return isQueueEntry(payload, new Set(["pending_moderation"]));
}

function isReportQueueEntry(payload: RealtimePayload) {
  return isQueueEntry(payload, new Set(["open"]));
}

function isDsarQueueEntry(payload: RealtimePayload) {
  return isQueueEntry(payload, DSAR_ACTIVE_STATUSES);
}

function isContactSubmissionQueueEntry(payload: RealtimePayload) {
  return isQueueEntry(payload, new Set(["new"]));
}

export function AdminRealtimeRefresh() {
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
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      refresh();
    }, REFRESH_DEBOUNCE_MS);
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

  useRealtime({
    table: "verification_steps",
    event: "*",
    filterColumn: "status",
    filterValue: "pending",
    onEvent: (payload) => {
      if (isVerificationQueueEntry(payload as RealtimePayload)) {
        scheduleRefresh();
      }
    },
  });

  useRealtime({
    table: "listings",
    event: "*",
    filterColumn: "status",
    filterValue: "pending_moderation",
    onEvent: (payload) => {
      if (isModerationQueueEntry(payload as RealtimePayload)) {
        scheduleRefresh();
      }
    },
  });

  useRealtime({
    table: "businesses",
    event: "*",
    filterColumn: "status",
    filterValue: "pending_moderation",
    onEvent: (payload) => {
      if (isModerationQueueEntry(payload as RealtimePayload)) {
        scheduleRefresh();
      }
    },
  });

  useRealtime({
    table: "promotions",
    event: "*",
    filterColumn: "status",
    filterValue: "pending_moderation",
    onEvent: (payload) => {
      if (isModerationQueueEntry(payload as RealtimePayload)) {
        scheduleRefresh();
      }
    },
  });

  useRealtime({
    table: "reports",
    event: "*",
    filterColumn: "status",
    filterValue: "open",
    onEvent: (payload) => {
      if (isReportQueueEntry(payload as RealtimePayload)) {
        scheduleRefresh();
      }
    },
  });

  useRealtime({
    table: "dsar_cases",
    event: "*",
    onEvent: (payload) => {
      if (isDsarQueueEntry(payload as RealtimePayload)) {
        scheduleRefresh();
      }
    },
  });

  useRealtime({
    table: "contact_submissions",
    event: "*",
    filterColumn: "status",
    filterValue: "new",
    onEvent: (payload) => {
      if (isContactSubmissionQueueEntry(payload as RealtimePayload)) {
        scheduleRefresh();
      }
    },
  });

  // Staff notifications also cover edits, whose live source rows do not change.
  useRealtime({
    table: "notifications",
    event: "INSERT",
    onEvent: (payload) => {
      if ((payload as RealtimePayload).new?.href === "/admin/moderation") {
        scheduleRefresh();
      }
    },
  });

  return null;
}

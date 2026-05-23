"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/hooks/use-realtime";

const REFRESH_DEBOUNCE_MS = 400;
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

  const scheduleRefresh = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      startTransition(() => {
        router.refresh();
      });
    }, REFRESH_DEBOUNCE_MS);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

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

  return null;
}

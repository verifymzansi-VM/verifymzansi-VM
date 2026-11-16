"use client";

import { useEffect, useMemo, useRef } from "react";
import { ToastAction, type ToastProps } from "@/components/ui/toast";
import { useRealtime } from "@/hooks/use-realtime";
import { toast } from "@/hooks/use-toast";

export type NotificationInsertRow = {
  id?: string;
  title?: string;
  message?: string;
  href?: string;
  read?: boolean;
};

type LiveNotificationEvent = {
  notificationId?: string;
  row: NotificationInsertRow;
  title: string;
  description: string;
  targetHref: string;
};

interface UseLiveNotificationListenerOptions {
  userId?: string;
  matches: (row: NotificationInsertRow) => boolean;
  fallbackTitle: string;
  fallbackDescription: string;
  fallbackHref: string;
  toastVariant: ToastProps["variant"];
  actionAltText: string;
  actionLabel: string;
  afterToast?: (event: LiveNotificationEvent) => void;
}

const MAX_SEEN_NOTIFICATIONS = 200;

function resolveTargetHref(row: NotificationInsertRow, fallbackHref: string) {
  return typeof row.href === "string" &&
    row.href.startsWith("/") &&
    !row.href.startsWith("//") &&
    !/[\\\u0000-\u0020\u007f]/.test(row.href)
    ? row.href
    : fallbackHref;
}

export function useLiveNotificationListener({
  userId,
  matches,
  fallbackTitle,
  fallbackDescription,
  fallbackHref,
  toastVariant,
  actionAltText,
  actionLabel,
  afterToast,
}: UseLiveNotificationListenerOptions) {
  const seenNotificationIds = useRef<Set<string>>(new Set());
  const seenNotificationOrder = useRef<string[]>([]);
  const nativeHydrated = useRef(false);
  const generation = useRef(0);
  const nativeReadVersion = useRef(0);
  const enabled = useMemo(() => Boolean(userId), [userId]);

  // Reset dedup state when the authenticated user changes so stale IDs from
  // a previous session don't suppress toasts for the new user.
  useEffect(() => {
    seenNotificationIds.current = new Set();
    seenNotificationOrder.current = [];
    nativeHydrated.current = false;
    generation.current++;
  }, [userId]);

  function receive(payload: Record<string, unknown>) {
    if (payload.eventType === "REVALIDATE") {
      const version = generation.current;
      const readVersion = ++nativeReadVersion.current;
      void fetch("/api/notifications?limit=25", { cache: "no-store", credentials: "same-origin" })
        .then(async (response) => {
          if (!response.ok) return;
          const data = await response.json();
          if (
            version !== generation.current ||
            readVersion !== nativeReadVersion.current ||
            data.accountId !== userId ||
            !Array.isArray(data.notifications)
          )
            return;
          if (!nativeHydrated.current) {
            nativeHydrated.current = true;
            for (const row of data.notifications as NotificationInsertRow[]) {
              if (row.id) {
                seenNotificationIds.current.add(row.id);
                seenNotificationOrder.current.push(row.id);
              }
            }
            return;
          }
          for (const row of data.notifications as NotificationInsertRow[])
            if (!row.read) receive({ new: row });
        })
        .catch(() => {});
      return;
    }
    const row = (payload.new ?? payload) as NotificationInsertRow;
    if (!matches(row)) {
      return;
    }

    const notificationId = row.id;
    if (notificationId) {
      if (seenNotificationIds.current.has(notificationId)) {
        return;
      }

      seenNotificationIds.current.add(notificationId);
      seenNotificationOrder.current.push(notificationId);

      if (seenNotificationOrder.current.length > MAX_SEEN_NOTIFICATIONS) {
        const removed = seenNotificationOrder.current.shift();
        if (removed) {
          seenNotificationIds.current.delete(removed);
        }
      }
    }

    const title = row.title || fallbackTitle;
    const description = row.message || fallbackDescription;
    const targetHref = resolveTargetHref(row, fallbackHref);

    toast({
      title,
      description,
      variant: toastVariant,
      action: (
        <ToastAction
          altText={actionAltText}
          onClick={() => {
            if (typeof window !== "undefined") {
              window.location.assign(targetHref);
            }
          }}
        >
          {actionLabel}
        </ToastAction>
      ),
    });

    afterToast?.({ notificationId, row, title, description, targetHref });
  }
  useRealtime({
    table: "notifications",
    event: "INSERT",
    filterColumn: userId ? "user_id" : undefined,
    filterValue: userId,
    enabled,
    onEvent: receive,
  });
}

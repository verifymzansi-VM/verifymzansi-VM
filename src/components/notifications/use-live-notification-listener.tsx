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
  return typeof row.href === "string" && row.href.startsWith("/") ? row.href : fallbackHref;
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
  const enabled = useMemo(() => Boolean(userId), [userId]);

  // Reset dedup state when the authenticated user changes so stale IDs from
  // a previous session don't suppress toasts for the new user.
  useEffect(() => {
    seenNotificationIds.current = new Set();
    seenNotificationOrder.current = [];
  }, [userId]);

  useRealtime({
    table: "notifications",
    event: "INSERT",
    filterColumn: userId ? "user_id" : undefined,
    filterValue: userId,
    enabled,
    onEvent: (payload) => {
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
    },
  });
}

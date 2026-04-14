"use client";

import { useMemo, useRef } from "react";
import { ToastAction } from "@/components/ui/toast";
import { useRealtime } from "@/hooks/use-realtime";
import { toast } from "@/hooks/use-toast";

interface AdminLiveNotifierProps {
  userId?: string;
}

type NotificationInsertRow = {
  id?: string;
  title?: string;
  message?: string;
  href?: string;
};

function isAdminNotification(row: NotificationInsertRow): boolean {
  return typeof row.href === "string" && row.href.startsWith("/admin");
}

export function AdminLiveNotifier({ userId }: AdminLiveNotifierProps) {
  const seenNotificationIds = useRef<Set<string>>(new Set());
  const seenNotificationOrder = useRef<string[]>([]);
  const enabled = useMemo(() => Boolean(userId), [userId]);

  useRealtime({
    table: "notifications",
    event: "INSERT",
    filterColumn: userId ? "user_id" : undefined,
    filterValue: userId,
    enabled,
    onEvent: (payload) => {
      const row = (payload.new ?? payload) as NotificationInsertRow;
      if (!isAdminNotification(row)) {
        return;
      }

      const notificationId = row.id;
      if (notificationId) {
        if (seenNotificationIds.current.has(notificationId)) {
          return;
        }

        seenNotificationIds.current.add(notificationId);
        seenNotificationOrder.current.push(notificationId);

        if (seenNotificationOrder.current.length > 200) {
          const removed = seenNotificationOrder.current.shift();
          if (removed) {
            seenNotificationIds.current.delete(removed);
          }
        }
      }

      const title = row.title || "New admin request";
      const description = row.message || "A new item needs staff review.";
      const targetHref =
        typeof row.href === "string" && row.href.startsWith("/") ? row.href : "/admin";

      toast({
        title,
        description,
        variant: "default",
        action: (
          <ToastAction
            altText="Open admin queue"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.assign(targetHref);
              }
            }}
          >
            Open
          </ToastAction>
        ),
      });
    },
  });

  return null;
}

"use client";

import { useMemo, useRef } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

interface LiveLeadNotifierProps {
  userId?: string;
}

type NotificationInsertRow = {
  id?: string;
  title?: string;
  message?: string;
  href?: string;
};

function isLeadNotification(row: NotificationInsertRow): boolean {
  if (typeof row.href === "string" && row.href.startsWith("/dashboard/leads")) {
    return true;
  }

  const title = row.title?.toLowerCase() || "";
  return title.includes("lead");
}

export function LiveLeadNotifier({ userId }: LiveLeadNotifierProps) {
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
      if (!isLeadNotification(row)) {
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

      const title = row.title || "New lead received";
      const description = row.message || "A buyer sent you a new enquiry.";
      const targetHref =
        typeof row.href === "string" && row.href.startsWith("/") ? row.href : "/dashboard/leads";

      toast({
        title,
        description,
        variant: "success",
        action: (
          <ToastAction
            altText="Open leads inbox"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.assign(targetHref);
              }
            }}
          >
            View
          </ToastAction>
        ),
      });

      if (typeof window === "undefined" || !("Notification" in window)) {
        return;
      }

      if (document.visibilityState === "visible") {
        return;
      }

      if (Notification.permission !== "granted") {
        return;
      }

      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker.ready
          .then((registration) =>
            registration.showNotification("VerifyMzansi", {
              body: description,
              icon: "/icons/icon-192.png?v=10",
              tag: notificationId ? `lead-${notificationId}` : "lead-alert",
              data: { url: targetHref },
            })
          )
          .catch(() => {
            // Fall back to Window Notification below if SW notifications fail.
            const fallbackNotice = new Notification("VerifyMzansi", {
              body: description,
              icon: "/icons/icon-192.png?v=10",
              tag: notificationId ? `lead-${notificationId}` : "lead-alert",
            });

            fallbackNotice.onclick = () => {
              window.focus();
              window.location.assign(targetHref);
            };
          });

        return;
      }

      const browserNotice = new Notification("VerifyMzansi", {
        body: description,
        icon: "/icons/icon-192.png?v=10",
        tag: notificationId ? `lead-${notificationId}` : "lead-alert",
      });

      browserNotice.onclick = () => {
        window.focus();
        window.location.assign(targetHref);
      };
    },
  });

  return null;
}

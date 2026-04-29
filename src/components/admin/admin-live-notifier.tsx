"use client";

import {
  type NotificationInsertRow,
  useLiveNotificationListener,
} from "@/components/notifications/use-live-notification-listener";

interface AdminLiveNotifierProps {
  userId?: string;
}

function isAdminNotification(row: NotificationInsertRow): boolean {
  return typeof row.href === "string" && row.href.startsWith("/admin");
}

export function AdminLiveNotifier({ userId }: AdminLiveNotifierProps) {
  useLiveNotificationListener({
    userId,
    matches: isAdminNotification,
    fallbackTitle: "New admin request",
    fallbackDescription: "A new item needs staff review.",
    fallbackHref: "/admin",
    toastVariant: "default",
    actionAltText: "Open admin queue",
    actionLabel: "Open",
  });

  return null;
}

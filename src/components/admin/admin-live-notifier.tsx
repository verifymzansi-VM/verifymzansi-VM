"use client";

import {
  type NotificationInsertRow,
  useLiveNotificationListener,
} from "@/components/notifications/use-live-notification-listener";

interface AdminLiveNotifierProps {
  userId?: string;
  userRole?: string;
}

const ROLE_NOTIFICATION_COPY: Record<
  string,
  {
    fallbackTitle: string;
    fallbackDescription: string;
    actionAltText: string;
    actionLabel: string;
  }
> = {
  moderator: {
    fallbackTitle: "New operations queue item",
    fallbackDescription: "A verification, report, or moderation task needs review.",
    actionAltText: "Open operations queue",
    actionLabel: "Open queue",
  },
  governance_controller: {
    fallbackTitle: "New governance decision",
    fallbackDescription: "An escalation, appeal, or enforcement item needs a decision.",
    actionAltText: "Open governance center",
    actionLabel: "Review",
  },
  admin: {
    fallbackTitle: "New platform signal",
    fallbackDescription: "A platform queue or governance signal needs attention.",
    actionAltText: "Open admin command center",
    actionLabel: "Open",
  },
};

function isRelevantAdminNotification(row: NotificationInsertRow, userRole?: string): boolean {
  if (typeof row.href !== "string" || !row.href.startsWith("/admin")) {
    return false;
  }

  if (userRole === "governance_controller") {
    return (
      row.href.startsWith("/admin/governance") ||
      row.href.startsWith("/admin/dsar") ||
      row.href.startsWith("/admin/reports")
    );
  }

  if (userRole === "moderator") {
    return (
      row.href === "/admin" ||
      row.href.startsWith("/admin/verification") ||
      row.href.startsWith("/admin/moderation") ||
      row.href.startsWith("/admin/reports") ||
      row.href.startsWith("/admin/mzansi-market") ||
      row.href.startsWith("/admin/businesses") ||
      row.href.startsWith("/admin/tourism-events")
    );
  }

  return true;
}

export function AdminLiveNotifier({ userId, userRole = "moderator" }: AdminLiveNotifierProps) {
  const copy = ROLE_NOTIFICATION_COPY[userRole] ?? ROLE_NOTIFICATION_COPY.moderator;

  useLiveNotificationListener({
    userId,
    matches: (row) => isRelevantAdminNotification(row, userRole),
    fallbackTitle: copy.fallbackTitle,
    fallbackDescription: copy.fallbackDescription,
    fallbackHref: "/admin",
    toastVariant: "default",
    actionAltText: copy.actionAltText,
    actionLabel: copy.actionLabel,
  });

  return null;
}

"use client";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useFoundationInboxCounts } from "@/hooks/use-foundation-inbox-counts";

export function FoundationNotificationBell() {
  const counts = useFoundationInboxCounts();
  return (
    <Link
      href="/dashboard/communication"
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted"
      aria-label={
        counts?.unread_notifications
          ? `${counts.unread_notifications} unread notifications`
          : "Notifications"
      }
    >
      <Bell className="h-5 w-5" />
      {Boolean(counts?.unread_notifications) && (
        <span className="absolute right-0 top-0 rounded-full bg-primary px-1 text-xs text-primary-foreground">
          {counts!.unread_notifications > 99 ? "99+" : counts!.unread_notifications}
        </span>
      )}
    </Link>
  );
}

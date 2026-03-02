"use client";

import { useEffect, useRef } from "react";
import { Bell, Check, CheckCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificationStore, type Notification } from "@/stores/notification-store";
import { useRealtime } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";
import Link from "next/link";

/**
 * Notification bell with unread badge + dropdown panel.
 * Hydrates from the API on mount, then listens for Supabase Realtime `INSERT`
 * events on the `notifications` table for live updates.
 */
export function NotificationBell({ userId }: { userId?: string }) {
  const { notifications, unreadCount, addNotification, markRead, markAllRead, clearAll } =
    useNotificationStore();
  const hydratedRef = useRef(false);

  // Hydrate from API on mount
  useEffect(() => {
    if (!userId || hydratedRef.current) return;
    hydratedRef.current = true;

    fetch("/api/notifications?limit=25")
      .then((r) => r.json())
      .then((data) => {
        if (data.notifications && Array.isArray(data.notifications)) {
          // Load existing notifications into the store (newest first)
          for (const n of data.notifications.reverse()) {
            addNotification({
              type: n.type ?? "info",
              title: n.title ?? "Notification",
              message: n.message ?? undefined,
              href: n.href ?? undefined,
            });
          }
        }
      })
      .catch(() => {
        // Silently fail — notifications are non-critical
      });
  }, [userId, addNotification]);

  // Subscribe to real-time notifications for the authenticated user
  useRealtime({
    table: "notifications",
    event: "INSERT",
    filterColumn: userId ? "user_id" : undefined,
    filterValue: userId,
    enabled: !!userId,
    onEvent: (payload: Record<string, unknown>) => {
      addNotification({
        type: (payload.type as "info" | "success" | "warning" | "error") ?? "info",
        title: (payload.title as string) ?? "New notification",
        message: payload.message as string | undefined,
        href: payload.href as string | undefined,
      });
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          <div className="flex gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>
                <CheckCheck className="mr-1 h-3 w-3" />
                Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={clearAll}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Notification list */}
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
            <Bell className="mb-2 h-8 w-8 opacity-20" />
            No notifications yet
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y" aria-label="Notifications">
              {notifications.map((n) => (
                <NotificationItem key={n.id} notification={n} onRead={markRead} />
              ))}
            </ul>
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationItem({
  notification: n,
  onRead,
}: {
  notification: Notification;
  onRead: (id: string) => void;
}) {
  const timeAgo = getRelativeTime(n.createdAt);

  const inner = (
    <div
      className={cn(
        "flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50",
        !n.read && "bg-muted/30"
      )}
    >
      {/* Type indicator */}
      <div
        className={cn(
          "mt-1 h-2 w-2 flex-shrink-0 rounded-full",
          n.type === "success" && "bg-brand-green",
          n.type === "warning" && "bg-brand-gold",
          n.type === "error" && "bg-destructive",
          n.type === "info" && "bg-primary"
        )}
      />

      <div className="flex-1 min-w-0">
        <p className={cn("text-sm", !n.read && "font-medium")}>{n.title}</p>
        {n.message && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.message}</p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">{timeAgo}</p>
      </div>

      {!n.read && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRead(n.id);
          }}
          className="mt-1 flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="Mark as read"
        >
          <Check className="h-3 w-3" />
        </button>
      )}
    </div>
  );

  if (n.href) {
    return (
      <li>
        <Link href={n.href} onClick={() => onRead(n.id)}>
          {inner}
        </Link>
      </li>
    );
  }

  return <li>{inner}</li>;
}

function getRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

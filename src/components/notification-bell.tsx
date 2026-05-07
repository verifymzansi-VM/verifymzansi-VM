"use client";

import { useEffect, useRef, useCallback } from "react";
import { Bell, Check, CheckCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificationStore, type Notification } from "@/stores/notification-store";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { useRealtime } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";
import Link from "next/link";

const NOTIFICATION_REFRESH_INTERVAL_MS = 10_000;

function mapNotificationRow(n: Record<string, unknown>): Notification {
  const dbId = n.id as string | undefined;
  return {
    id: dbId ?? crypto.randomUUID(),
    type: (n.type as "info" | "success" | "warning" | "error") ?? "info",
    title: (n.title as string) ?? "Notification",
    message: (n.message as string) ?? undefined,
    href: (n.href as string) ?? undefined,
    read: (n.read as boolean) ?? false,
    createdAt: (n.created_at as string) ?? new Date().toISOString(),
  };
}

/**
 * Notification bell with unread badge + dropdown panel.
 * Hydrates from the API on mount, then listens for Supabase Realtime `INSERT`
 * events on the `notifications` table for live updates. A short polling
 * fallback keeps the badge current if the realtime socket is unavailable.
 */
export function NotificationBell({ userId }: { userId?: string }) {
  const {
    notifications,
    unreadCount,
    addNotification,
    hydrateNotifications,
    markRead,
    markAllRead,
    clearAll,
  } = useNotificationStore();
  const mountedRef = useRef(true);
  const currentUserRef = useRef<string | undefined>(userId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshNotifications = useCallback(
    async (signal?: AbortSignal) => {
      const requestUserId = currentUserRef.current;
      if (!requestUserId) return;

      await fetch("/api/notifications?limit=25", {
        signal,
        cache: "no-store",
        credentials: "same-origin",
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data) => {
          if (signal?.aborted || !mountedRef.current || currentUserRef.current !== requestUserId) {
            return;
          }
          if (data.notifications && Array.isArray(data.notifications)) {
            // Map DB rows -> store Notification objects, preserving id + read status.
            const mapped = data.notifications.map(mapNotificationRow);
            hydrateNotifications(
              mapped,
              typeof data.unreadCount === "number" ? data.unreadCount : undefined
            );
          }
        })
        .catch(() => {
          // Silently fail — notifications are non-critical
        });
    },
    [hydrateNotifications]
  );

  // Hydrate from API on mount (re-runs when userId changes)
  useEffect(() => {
    currentUserRef.current = userId;
    if (!userId) {
      clearAll();
      return;
    }

    // Flush previous user's notifications before fetching
    clearAll();

    const controller = new AbortController();
    void refreshNotifications(controller.signal);

    return () => controller.abort();
  }, [userId, refreshNotifications, clearAll]);

  useEffect(() => {
    if (!userId) return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshNotifications();
      }
    };

    const intervalId = window.setInterval(refreshIfVisible, NOTIFICATION_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [userId, refreshNotifications]);

  // Subscribe to real-time notifications for the authenticated user
  useRealtime({
    table: "notifications",
    event: "INSERT",
    filterColumn: userId ? "user_id" : undefined,
    filterValue: userId,
    enabled: !!userId,
    onEvent: (payload: Record<string, unknown>) => {
      // Supabase Realtime puts the inserted row in `payload.new`
      const row = (payload.new ?? payload) as Record<string, unknown>;
      addNotification({
        id: row.id as string | undefined,
        type: (row.type as "info" | "success" | "warning" | "error") ?? "info",
        title: (row.title as string) ?? "New notification",
        message: row.message as string | undefined,
        href: row.href as string | undefined,
        createdAt: (row.created_at as string) ?? undefined,
      });
    },
  });

  // ── API-synced action wrappers ─────────────────────────────────────
  const handleMarkRead = useCallback(
    (id: string) => {
      const prev = useNotificationStore.getState();
      markRead(id);
      fetch("/api/notifications", {
        method: "PATCH",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id }),
      }).catch(() => {
        if (!mountedRef.current) return;
        useNotificationStore.setState({
          notifications: prev.notifications,
          unreadCount: prev.unreadCount,
        });
      });
    },
    [markRead]
  );

  const handleMarkAllRead = useCallback(() => {
    const prev = useNotificationStore.getState();
    markAllRead();
    fetch("/api/notifications", {
      method: "PATCH",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ all: true }),
    }).catch(() => {
      if (!mountedRef.current) return;
      useNotificationStore.setState({
        notifications: prev.notifications,
        unreadCount: prev.unreadCount,
      });
    });
  }, [markAllRead]);

  const handleClearAll = useCallback(() => {
    const prev = useNotificationStore.getState();
    clearAll();
    fetch("/api/notifications", {
      method: "DELETE",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ all: true }),
    }).catch(() => {
      if (!mountedRef.current) return;
      useNotificationStore.setState({
        notifications: prev.notifications,
        unreadCount: prev.unreadCount,
      });
    });
  }, [clearAll]);

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
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] sm:w-80 max-w-sm p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          <div className="flex gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleMarkAllRead}>
                <CheckCheck className="mr-1 h-3 w-3" />
                Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={handleClearAll}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Notification list */}
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-sm text-muted-foreground">
            <Bell className="mb-1.5 h-6 w-6 opacity-20" />
            No notifications yet
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y" aria-label="Notifications">
              {notifications.map((n) => (
                <NotificationItem key={n.id} notification={n} onRead={handleMarkRead} />
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

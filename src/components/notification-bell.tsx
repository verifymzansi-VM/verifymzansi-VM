"use client";

import { useEffect, useRef, useCallback } from "react";
import { Bell, Check, CheckCheck, ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
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
import { formatRelativeTime, formatSaLongDate } from "@/lib/utils/format";

const NOTIFICATION_REFRESH_INTERVAL_MS = 10_000;

function mapNotificationRow(n: Record<string, unknown>): Notification | null {
  const dbId = n.id;
  // Rows without a valid DB id cannot be mutated (PATCH/DELETE would no-op
  // against a fabricated UUID), so skip them rather than render a broken item.
  if (typeof dbId !== "string" || dbId.length === 0) {
    return null;
  }
  // Only allow relative hrefs to prevent open-redirect via crafted notifications.
  const rawHref = n.href as string | undefined;
  const href =
    typeof rawHref === "string" &&
    rawHref.startsWith("/") &&
    !rawHref.startsWith("//") &&
    !/[\\\u0000-\u0020\u007f]/.test(rawHref)
      ? rawHref
      : undefined;
  return {
    id: dbId,
    type: (n.type as "info" | "success" | "warning" | "error") ?? "info",
    title: (n.title as string) ?? "Notification",
    message: (n.message as string) ?? undefined,
    href,
    read: (n.read as boolean) ?? false,
    createdAt: (n.created_at as string) ?? new Date().toISOString(),
  };
}

async function syncNotificationMutation(
  body: { id: string } | { all: true },
  method: "PATCH" | "DELETE"
) {
  const response = await fetch("/api/notifications", {
    method,
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Notification update failed with HTTP ${response.status}`);
  }
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
    removeNotification,
    clearAll,
  } = useNotificationStore();
  const mountedRef = useRef(true);
  const currentUserRef = useRef<string | undefined>(userId);
  const accountGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshNotifications = useCallback(
    async (signal?: AbortSignal) => {
      const requestUserId = currentUserRef.current;
      const requestGeneration = accountGenerationRef.current;
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
          if (
            signal?.aborted ||
            !mountedRef.current ||
            currentUserRef.current !== requestUserId ||
            accountGenerationRef.current !== requestGeneration
          ) {
            return;
          }
          if (data.notifications && Array.isArray(data.notifications)) {
            // Map DB rows -> store Notification objects, preserving id + read status.
            // Rows without a valid id are dropped (they can't be mutated server-side).
            const mapped = data.notifications
              .map(mapNotificationRow)
              .filter((n: Notification | null): n is Notification => n !== null);
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
    accountGenerationRef.current += 1;
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
      if (!userId || (row.user_id && row.user_id !== currentUserRef.current)) return;
      const notification = mapNotificationRow(row);
      if (notification) addNotification(notification);
    },
  });

  // A failed optimistic mutation re-fetches server truth. Restoring a captured
  // snapshot can overwrite newer realtime events or another account's data.
  const recoverMutation = useCallback(
    (body: { id: string } | { all: true }, method: "PATCH" | "DELETE") => {
      const requestGeneration = accountGenerationRef.current;
      void syncNotificationMutation(body, method).catch(() => {
        if (!mountedRef.current || accountGenerationRef.current !== requestGeneration) return;
        void refreshNotifications();
      });
    },
    [refreshNotifications]
  );

  const handleMarkRead = useCallback(
    (id: string) => {
      const notification = useNotificationStore.getState().notifications.find((n) => n.id === id);
      if (!notification || notification.read) return;
      markRead(id);
      recoverMutation({ id }, "PATCH");
    },
    [markRead, recoverMutation]
  );

  const handleMarkAllRead = useCallback(() => {
    markAllRead();
    recoverMutation({ all: true }, "PATCH");
  }, [markAllRead, recoverMutation]);

  const handleClearAll = useCallback(() => {
    clearAll();
    recoverMutation({ all: true }, "DELETE");
  }, [clearAll, recoverMutation]);

  const handleDismiss = useCallback(
    (id: string) => {
      removeNotification(id);
      recoverMutation({ id }, "DELETE");
    },
    [removeNotification, recoverMutation]
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-background">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] max-w-md p-0 sm:w-96">
        {/* Header */}
        <div className="border-b px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Notifications</h3>
              <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
                {notifications.length === 0
                  ? "You are all caught up"
                  : unreadCount > 0
                    ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"}`
                    : "Everything has been read"}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleMarkAllRead}
                >
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
                  aria-label="Clear all notifications"
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Clear all
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Notification list */}
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-brand-green/10 text-brand-green dark:bg-brand-green/15 dark:text-brand-green-300">
              <Bell className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="font-medium text-foreground">No notifications yet</p>
            <p className="mt-1 text-xs">Account and post updates show up here.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="divide-y" aria-label="Notifications">
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onRead={handleMarkRead}
                  onDismiss={handleDismiss}
                />
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
  onDismiss,
}: {
  notification: Notification;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const timeAgo = formatRelativeTime(n.createdAt);
  const typeLabel = getNotificationTypeLabel(n.type);

  return (
    <li
      className={cn(
        "group flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-within:bg-muted/50",
        !n.read && "bg-muted/30"
      )}
    >
      {/* Type indicator */}
      <div
        className={cn(
          "mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full",
          n.type === "success" && "bg-brand-green",
          n.type === "warning" && "bg-brand-gold",
          n.type === "error" && "bg-destructive",
          n.type === "info" && "bg-primary"
        )}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={cn("text-sm leading-snug", !n.read && "font-semibold")}>{n.title}</p>
            {n.message && (
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {n.message}
              </p>
            )}
          </div>

          {!n.read && (
            <span className="mt-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              New
            </span>
          )}
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          <span>{typeLabel}</span>
          <span aria-hidden="true"> · </span>
          <time
            dateTime={n.createdAt}
            suppressHydrationWarning
            title={formatSaLongDate(n.createdAt)}
          >
            {timeAgo}
          </time>
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {n.href && (
            <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
              <Link href={n.href} onClick={() => onRead(n.id)}>
                <ExternalLink className="mr-1 h-3 w-3" />
                Open
              </Link>
            </Button>
          )}
          {!n.read && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => onRead(n.id)}
            >
              <Check className="mr-1 h-3 w-3" />
              Mark read
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => onDismiss(n.id)}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Dismiss
          </Button>
        </div>
      </div>
    </li>
  );
}

function getNotificationTypeLabel(type: Notification["type"]): string {
  switch (type) {
    case "success":
      return "Success";
    case "warning":
    case "error":
      return "Needs attention";
    default:
      return "Update";
  }
}

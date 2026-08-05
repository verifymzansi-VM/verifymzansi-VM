import { create } from "zustand";

export interface Notification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  read: boolean;
  createdAt: string;
  href?: string;
}

/** Fallback UUID generator for contexts where crypto.randomUUID is unavailable. */
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;

  /** Add a new notification. If `id` is provided and already exists, skip (dedup). */
  addNotification: (
    n: Omit<Notification, "id" | "read" | "createdAt"> & { id?: string; createdAt?: string }
  ) => void;
  /** Replace the entire notification list (used for initial API hydration). */
  hydrateNotifications: (notifications: Notification[], unreadCount?: number) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,

  addNotification: (n) =>
    set((state) => {
      // Dedup: if an id was supplied and already exists, skip the insert
      if (n.id && state.notifications.some((existing) => existing.id === n.id)) {
        return state;
      }

      const notification: Notification = {
        ...n,
        id: n.id || generateId(),
        read: false,
        createdAt: n.createdAt ?? new Date().toISOString(),
      };
      const combined = [notification, ...state.notifications];
      const dropped = combined.slice(50);
      const notifications = combined.slice(0, 50);
      // If the cap forced out any unread notifications, adjust the count so
      // the badge doesn't drift upward until the next hydration.
      const droppedUnread = dropped.filter((d) => !d.read).length;
      return {
        notifications,
        unreadCount: Math.max(0, state.unreadCount + 1 - droppedUnread),
      };
    }),

  hydrateNotifications: (incoming, unreadCount) =>
    set((state) => {
      // Merge incoming rows with existing state so realtime additions that
      // arrived while the fetch was in-flight are not lost.
      const incomingIds = new Set(incoming.map((n) => n.id));
      const realtimeOnly = state.notifications.filter((n) => !incomingIds.has(n.id));

      // Dedupe incoming by id — realtime + polling can deliver overlapping rows.
      const seen = new Set<string>();
      const deduped = incoming.filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      });

      // Merge: incoming (server truth) first, then realtime-only items, sorted by date desc.
      const merged = [...deduped, ...realtimeOnly].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const notifications = merged.slice(0, 50);
      return {
        notifications,
        unreadCount: unreadCount ?? notifications.filter((x) => !x.read).length,
      };
    }),

  markRead: (id) =>
    set((state) => {
      const target = state.notifications.find((n) => n.id === id);
      if (!target || target.read) {
        return state;
      }
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      return {
        notifications,
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    }),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  removeNotification: (id) =>
    set((state) => {
      const removed = state.notifications.find((n) => n.id === id);
      const notifications = state.notifications.filter((n) => n.id !== id);
      return {
        notifications,
        unreadCount:
          removed && !removed.read ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
      };
    }),

  clearAll: () => set({ notifications: [], unreadCount: 0 }),
}));

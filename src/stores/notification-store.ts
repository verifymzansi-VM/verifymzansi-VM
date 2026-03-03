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

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;

  /** Add a new notification. If `id` is provided and already exists, skip (dedup). */
  addNotification: (
    n: Omit<Notification, "id" | "read" | "createdAt"> & { id?: string; createdAt?: string }
  ) => void;
  /** Replace the entire notification list (used for initial API hydration). */
  hydrateNotifications: (notifications: Notification[]) => void;
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
        id:
          n.id ||
          (typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2) + Date.now().toString(36)),
        read: false,
        createdAt: n.createdAt ?? new Date().toISOString(),
      };
      const notifications = [notification, ...state.notifications].slice(0, 50);
      return {
        notifications,
        unreadCount: notifications.filter((x) => !x.read).length,
      };
    }),

  hydrateNotifications: (incoming) =>
    set(() => {
      const notifications = incoming.slice(0, 50);
      return {
        notifications,
        unreadCount: notifications.filter((x) => !x.read).length,
      };
    }),

  markRead: (id) =>
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      return {
        notifications,
        unreadCount: notifications.filter((x) => !x.read).length,
      };
    }),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  removeNotification: (id) =>
    set((state) => {
      const notifications = state.notifications.filter((n) => n.id !== id);
      return {
        notifications,
        unreadCount: notifications.filter((x) => !x.read).length,
      };
    }),

  clearAll: () => set({ notifications: [], unreadCount: 0 }),
}));

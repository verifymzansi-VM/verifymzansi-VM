import { describe, it, expect, beforeEach, vi } from "vitest";
import { useNotificationStore } from "@/stores/notification-store";

// Polyfill crypto.randomUUID for test environment
vi.stubGlobal(
  "crypto",
  Object.assign({}, globalThis.crypto, {
    randomUUID: () =>
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      }),
  })
);

describe("notification-store", () => {
  beforeEach(() => {
    // Reset store state between tests
    const { clearAll } = useNotificationStore.getState();
    clearAll();
  });

  it("should start with empty notifications", () => {
    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications).toEqual([]);
    expect(unreadCount).toBe(0);
  });

  it("should add a notification", () => {
    const { addNotification } = useNotificationStore.getState();
    addNotification({ type: "info", title: "Test" });

    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe("Test");
    expect(notifications[0].type).toBe("info");
    expect(notifications[0].read).toBe(false);
    expect(unreadCount).toBe(1);
  });

  it("should mark a notification as read", () => {
    const { addNotification } = useNotificationStore.getState();
    addNotification({ type: "success", title: "Done" });

    const id = useNotificationStore.getState().notifications[0].id;
    useNotificationStore.getState().markRead(id);

    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications[0].read).toBe(true);
    expect(unreadCount).toBe(0);
  });

  it("should mark all as read", () => {
    const { addNotification } = useNotificationStore.getState();
    addNotification({ type: "info", title: "A" });
    addNotification({ type: "warning", title: "B" });

    useNotificationStore.getState().markAllRead();

    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications.every((n) => n.read)).toBe(true);
    expect(unreadCount).toBe(0);
  });

  it("should remove a notification", () => {
    const { addNotification } = useNotificationStore.getState();
    addNotification({ type: "error", title: "Fail" });
    addNotification({ type: "info", title: "Keep" });

    // Store prepends, so order is [Keep, Fail]. Remove "Fail" (index 1).
    const notifications = useNotificationStore.getState().notifications;
    const failId = notifications.find((n) => n.title === "Fail")!.id;
    useNotificationStore.getState().removeNotification(failId);

    const updated = useNotificationStore.getState().notifications;
    expect(updated).toHaveLength(1);
    expect(updated[0].title).toBe("Keep");
  });

  it("should clear all notifications", () => {
    const { addNotification } = useNotificationStore.getState();
    addNotification({ type: "info", title: "A" });
    addNotification({ type: "info", title: "B" });

    useNotificationStore.getState().clearAll();

    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications).toEqual([]);
    expect(unreadCount).toBe(0);
  });

  it("should cap at 50 notifications", () => {
    const { addNotification } = useNotificationStore.getState();
    for (let i = 0; i < 55; i++) {
      addNotification({ type: "info", title: `N${i}` });
    }
    const { notifications } = useNotificationStore.getState();
    expect(notifications.length).toBeLessThanOrEqual(50);
  });

  // ── Hydration & dedup tests ──────────────────────────────────────

  it("should hydrate notifications preserving id and read status", () => {
    const { hydrateNotifications } = useNotificationStore.getState();
    hydrateNotifications([
      {
        id: "db-uuid-1",
        type: "success",
        title: "Approved",
        read: true,
        createdAt: "2026-03-01T10:00:00Z",
      },
      {
        id: "db-uuid-2",
        type: "warning",
        title: "Pending",
        read: false,
        createdAt: "2026-03-02T12:00:00Z",
      },
    ]);

    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications).toHaveLength(2);
    expect(notifications[0].id).toBe("db-uuid-1");
    expect(notifications[0].read).toBe(true);
    expect(notifications[1].id).toBe("db-uuid-2");
    expect(notifications[1].read).toBe(false);
    expect(unreadCount).toBe(1);
  });

  it("should deduplicate addNotification when id already exists", () => {
    const { hydrateNotifications, addNotification } = useNotificationStore.getState();

    hydrateNotifications([
      {
        id: "existing-uuid",
        type: "info",
        title: "Already here",
        read: false,
        createdAt: "2026-03-02T12:00:00Z",
      },
    ]);

    // Attempt to add a Realtime event with the same id
    addNotification({
      id: "existing-uuid",
      type: "info",
      title: "Already here",
    });

    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(1);
  });

  it("should allow addNotification with a new id after hydration", () => {
    const { hydrateNotifications, addNotification } = useNotificationStore.getState();

    hydrateNotifications([
      {
        id: "hydrated-1",
        type: "info",
        title: "Old",
        read: true,
        createdAt: "2026-03-01T10:00:00Z",
      },
    ]);

    addNotification({
      id: "realtime-new",
      type: "success",
      title: "Fresh",
    });

    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications).toHaveLength(2);
    expect(notifications[0].id).toBe("realtime-new");
    expect(notifications[0].read).toBe(false);
    expect(unreadCount).toBe(1);
  });

  it("should preserve provided createdAt instead of overwriting", () => {
    const serverTimestamp = "2026-02-15T08:30:00.000Z";
    const { addNotification } = useNotificationStore.getState();

    addNotification({
      id: "ts-test-1",
      type: "info",
      title: "Server-timestamped",
      createdAt: serverTimestamp,
    });

    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].createdAt).toBe(serverTimestamp);
  });

  it("should default createdAt to current time when not provided", () => {
    const before = new Date().toISOString();
    const { addNotification } = useNotificationStore.getState();

    addNotification({
      type: "warning",
      title: "No explicit timestamp",
    });

    const after = new Date().toISOString();
    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].createdAt >= before).toBe(true);
    expect(notifications[0].createdAt <= after).toBe(true);
  });

  it("should preserve server unread count when hydrating a partial list", () => {
    const { hydrateNotifications } = useNotificationStore.getState();

    hydrateNotifications(
      [
        {
          id: "visible-1",
          type: "info",
          title: "Newest",
          read: false,
          createdAt: "2026-03-02T12:00:00Z",
        },
      ],
      27
    );

    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications).toHaveLength(1);
    expect(unreadCount).toBe(27);
  });

  it("should decrement server unread count when a visible unread item is marked read", () => {
    const { hydrateNotifications, markRead } = useNotificationStore.getState();

    hydrateNotifications(
      [
        {
          id: "visible-1",
          type: "info",
          title: "Newest",
          read: false,
          createdAt: "2026-03-02T12:00:00Z",
        },
      ],
      27
    );

    markRead("visible-1");

    const { notifications, unreadCount } = useNotificationStore.getState();
    expect(notifications[0].read).toBe(true);
    expect(unreadCount).toBe(26);
  });
});

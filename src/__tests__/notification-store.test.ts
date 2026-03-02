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
});

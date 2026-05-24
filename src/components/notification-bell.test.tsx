import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationStore } from "@/stores/notification-store";
import { NotificationBell } from "./notification-bell";

const realtimeOptions: Array<Record<string, unknown>> = [];

vi.mock("@/hooks/use-realtime", () => ({
  useRealtime: (options: Record<string, unknown>) => {
    realtimeOptions.push(options);
  },
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

vi.mock("lucide-react", () => ({
  Bell: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="bell-icon" {...props} />,
  Check: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="check-icon" {...props} />,
  CheckCheck: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-testid="check-check-icon" {...props} />
  ),
  ExternalLink: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-testid="external-link-icon" {...props} />
  ),
  Trash2: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="trash-icon" {...props} />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild,
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    variant?: string;
    size?: string;
  }) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(
        React.Children.only(children) as React.ReactElement<Record<string, unknown>>,
        props as Record<string, unknown>
      );
    }

    return <button {...props}>{children}</button>;
  },
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function mockNotificationsResponse(
  rows: Array<Record<string, unknown>>,
  unreadCount = rows.length
) {
  return Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        notifications: rows,
        unreadCount,
      }),
  } as Response);
}

async function flushNotificationFetch() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    realtimeOptions.length = 0;
    useNotificationStore.getState().clearAll();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useNotificationStore.getState().clearAll();
  });

  it("refreshes notifications periodically so missed realtime events update the badge", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        mockNotificationsResponse([
          {
            id: "notification-1",
            type: "info",
            title: "Initial item",
            read: false,
            created_at: "2026-05-07T08:00:00.000Z",
          },
        ])
      )
      .mockImplementationOnce(() =>
        mockNotificationsResponse([
          {
            id: "notification-2",
            type: "warning",
            title: "Fresh admin item",
            read: false,
            created_at: "2026-05-07T08:01:00.000Z",
          },
          {
            id: "notification-1",
            type: "info",
            title: "Initial item",
            read: false,
            created_at: "2026-05-07T08:00:00.000Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationBell userId="admin-1" />);

    await flushNotificationFetch();

    expect(screen.getByLabelText("Notifications (1 unread)")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications?limit=25",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flushNotificationFetch();

    expect(screen.getByLabelText("Notifications (2 unread)")).toBeTruthy();
    expect(screen.getByText("Fresh admin item")).toBeTruthy();
  });

  it("still subscribes to realtime inserts for immediate updates", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => mockNotificationsResponse([], 0))
    );

    render(<NotificationBell userId="admin-1" />);

    expect(realtimeOptions[0]).toMatchObject({
      table: "notifications",
      event: "INSERT",
      filterColumn: "user_id",
      filterValue: "admin-1",
      enabled: true,
    });
  });

  it("lets people dismiss a single notification without clearing the whole list", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        mockNotificationsResponse(
          [
            {
              id: "notification-1",
              type: "error",
              title: "Selfie verification rejected",
              message: "Please retake the selfie in better light.",
              read: false,
              created_at: "2026-05-07T08:00:00.000Z",
            },
            {
              id: "notification-2",
              type: "success",
              title: "ID document verification approved",
              read: true,
              created_at: "2026-05-07T07:00:00.000Z",
            },
          ],
          1
        )
      )
      .mockImplementationOnce(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationBell userId="admin-1" />);

    await flushNotificationFetch();

    await act(async () => {
      screen.getAllByRole("button", { name: /dismiss/i })[0].click();
    });

    expect(screen.queryByText("Selfie verification rejected")).toBeNull();
    expect(screen.getByText("ID document verification approved")).toBeTruthy();
    expect(useNotificationStore.getState().unreadCount).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ id: "notification-1" }),
      })
    );
  });
});

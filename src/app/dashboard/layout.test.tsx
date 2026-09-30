import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockSignOut, mockPush } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockSignOut: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: mockCreateClient }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));
vi.mock("@/components/layout/header", () => ({ Header: () => null }));
vi.mock("@/components/dashboard/dashboard-mobile-nav", () => ({ DashboardMobileNav: () => null }));
vi.mock("@/components/dashboard/suspension-notice", () => ({ SuspensionNotice: () => null }));
vi.mock("@/hooks/use-leads-unread", () => ({ useLeadsUnread: () => ({ unreadCount: 0 }) }));
vi.mock("@/components/dashboard/dashboard-sidebar", () => ({
  DashboardSidebar: ({ onSignOut }: { onSignOut: () => void }) => (
    <button type="button" onClick={onSignOut}>
      Sign out
    </button>
  ),
}));

import DashboardLayout from "./layout";
import { useAuthStore } from "@/stores/auth-store";
import { useNotificationStore } from "@/stores/notification-store";

describe("DashboardLayout sign-out", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockReturnValue({
      auth: {
        signOut: mockSignOut,
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "http://localhost", assign: vi.fn() },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("clears the previous account's client state and hard-navigates home", async () => {
    mockSignOut.mockResolvedValue({ error: null });
    act(() => {
      useAuthStore
        .getState()
        .setUser({ id: "u1", email: "a@example.com", displayName: "A", role: "user" });
      useNotificationStore.getState().addNotification({ type: "info", title: "Private lead" });
    });

    render(
      <DashboardLayout>
        <p>content</p>
      </DashboardLayout>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(window.location.assign).toHaveBeenCalledWith("http://localhost/");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("keeps the user on the dashboard when sign-out fails", async () => {
    mockSignOut.mockResolvedValue({ error: new Error("network") });
    render(
      <DashboardLayout>
        <p>content</p>
      </DashboardLayout>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    });

    expect(window.location.assign).not.toHaveBeenCalled();
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});

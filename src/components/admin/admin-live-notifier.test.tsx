import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminLiveNotifier } from "./admin-live-notifier";

const realtimeOptions: Array<Record<string, unknown>> = [];
const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock("@/hooks/use-realtime", () => ({
  useRealtime: (options: Record<string, unknown>) => {
    realtimeOptions.push(options);
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
}));

describe("AdminLiveNotifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtimeOptions.length = 0;
  });

  it("subscribes to staff notifications and shows toasts for admin links", () => {
    render(<AdminLiveNotifier userId="admin-1" />);

    expect(realtimeOptions).toHaveLength(1);
    expect(realtimeOptions[0]).toMatchObject({
      table: "notifications",
      event: "INSERT",
      filterColumn: "user_id",
      filterValue: "admin-1",
      enabled: true,
    });

    const onEvent = realtimeOptions[0].onEvent as (payload: Record<string, unknown>) => void;
    onEvent({
      new: {
        id: "notif-1",
        title: "New report submitted",
        message: "A new report is waiting in the reports queue.",
        href: "/admin/reports",
      },
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New report submitted",
        description: "A new report is waiting in the reports queue.",
        variant: "default",
      })
    );
  });

  it("ignores non-admin notifications", () => {
    render(<AdminLiveNotifier userId="admin-1" />);

    const onEvent = realtimeOptions[0].onEvent as (payload: Record<string, unknown>) => void;
    onEvent({
      new: {
        id: "notif-2",
        title: "New lead received!",
        message: "Someone is interested in your listing.",
        href: "/dashboard/leads",
      },
    });

    expect(mockToast).not.toHaveBeenCalled();
  });
});

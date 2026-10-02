import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRealtimeRefresh } from "./admin-realtime-refresh";

const realtimeOptions: Array<Record<string, unknown>> = [];
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

vi.mock("@/hooks/use-realtime", () => ({
  useRealtime: (options: Record<string, unknown>) => {
    realtimeOptions.push(options);
  },
}));

describe("AdminRealtimeRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    realtimeOptions.length = 0;
  });

  const notify = (href: string) => {
    const onEvent = realtimeOptions[0]?.onEvent as (payload: Record<string, unknown>) => void;
    onEvent({ eventType: "INSERT", new: { href } });
  };

  it("listens only to the viewer's own notifications, never to queue tables", () => {
    render(<AdminRealtimeRefresh userId="staff-1" />);

    expect(realtimeOptions).toHaveLength(1);
    expect(realtimeOptions[0]).toMatchObject({
      table: "notifications",
      event: "INSERT",
      filterColumn: "user_id",
      filterValue: "staff-1",
    });
  });

  it("refreshes for an admin notification, after the minimum gap", () => {
    render(<AdminRealtimeRefresh userId="staff-1" />);

    notify("/admin/moderation");

    // The page was rendered moments ago, so the refresh waits out the minimum gap.
    vi.advanceTimersByTime(9_999);
    expect(mockRefresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("ignores notifications that are not about admin work", () => {
    render(<AdminRealtimeRefresh userId="staff-1" />);
    vi.advanceTimersByTime(60_000);
    notify("/dashboard/listings");
    vi.advanceTimersByTime(10_000);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("merges a burst of events into one refresh, at most every 10 seconds", () => {
    render(<AdminRealtimeRefresh userId="staff-1" />);

    vi.advanceTimersByTime(60_000);
    for (let i = 0; i < 50; i++) notify("/admin/moderation");
    vi.advanceTimersByTime(400);
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    notify("/admin/moderation");
    vi.advanceTimersByTime(7_999);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes without a notification and cleans up its fallback", () => {
    const { unmount } = render(<AdminRealtimeRefresh userId="staff-1" />);
    vi.advanceTimersByTime(30_000);
    expect(mockRefresh).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus"));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(210_000);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("focus"));
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    unmount();
    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event("focus"));
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it("does not refresh twice when a notification overlaps the fallback", () => {
    render(<AdminRealtimeRefresh userId="staff-1" />);

    vi.advanceTimersByTime(119_800);
    notify("/admin/moderation");
    vi.advanceTimersByTime(600);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

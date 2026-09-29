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

  it("subscribes to the admin queue tables and refreshes for matching events", () => {
    render(<AdminRealtimeRefresh />);

    expect(realtimeOptions.map((option) => option.table)).toEqual([
      "verification_steps",
      "listings",
      "businesses",
      "promotions",
      "reports",
      "dsar_cases",
      "contact_submissions",
      "notifications",
    ]);

    const reportsRealtime = realtimeOptions.find((option) => option.table === "reports");
    const onEvent = reportsRealtime?.onEvent as (payload: Record<string, unknown>) => void;

    onEvent({
      eventType: "INSERT",
      new: { status: "open" },
    });

    // The page was rendered moments ago, so the refresh waits out the minimum gap.
    vi.advanceTimersByTime(9_999);
    expect(mockRefresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("merges a burst of events into one refresh, at most every 10 seconds", () => {
    render(<AdminRealtimeRefresh />);
    const onEvent = realtimeOptions.find((option) => option.table === "reports")?.onEvent as (
      payload: Record<string, unknown>
    ) => void;

    vi.advanceTimersByTime(60_000);
    for (let i = 0; i < 50; i++) onEvent({ eventType: "INSERT", new: { status: "open" } });
    vi.advanceTimersByTime(400);
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    onEvent({ eventType: "INSERT", new: { status: "open" } });
    vi.advanceTimersByTime(7_999);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes when staff receive a pending edit notification", () => {
    render(<AdminRealtimeRefresh />);
    const subscription = realtimeOptions.find((option) => option.table === "notifications");
    expect(subscription?.event).toBe("INSERT");
    const onEvent = subscription?.onEvent as (payload: Record<string, unknown>) => void;
    onEvent({ eventType: "INSERT", new: { href: "/admin/moderation" } });
    vi.advanceTimersByTime(10_000);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes without a notification and cleans up its fallback", () => {
    const { unmount } = render(<AdminRealtimeRefresh />);
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

  it("does not refresh twice when a realtime event overlaps the fallback", () => {
    render(<AdminRealtimeRefresh />);
    const reportsRealtime = realtimeOptions.find((option) => option.table === "reports");
    const onEvent = reportsRealtime?.onEvent as (payload: Record<string, unknown>) => void;

    vi.advanceTimersByTime(119_800);
    onEvent({ eventType: "INSERT", new: { status: "open" } });
    vi.advanceTimersByTime(600);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("ignores queue events that do not enter a tracked admin status", () => {
    render(<AdminRealtimeRefresh />);

    const dsarRealtime = realtimeOptions.find((option) => option.table === "dsar_cases");
    const onEvent = dsarRealtime?.onEvent as (payload: Record<string, unknown>) => void;

    onEvent({
      eventType: "UPDATE",
      old: { status: "submitted" },
      new: { status: "completed" },
    });

    vi.advanceTimersByTime(401);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

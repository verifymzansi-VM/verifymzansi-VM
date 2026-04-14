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
    ]);

    const reportsRealtime = realtimeOptions.find((option) => option.table === "reports");
    const onEvent = reportsRealtime?.onEvent as (payload: Record<string, unknown>) => void;

    onEvent({
      eventType: "INSERT",
      new: { status: "open" },
    });

    vi.advanceTimersByTime(399);
    expect(mockRefresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
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

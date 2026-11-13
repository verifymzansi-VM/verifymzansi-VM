import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act as _act } from "@testing-library/react";

const mockChannel = vi.fn();
const mockOn = vi.fn();
const mockSubscribe = vi.fn();
const mockRemoveChannel = vi.fn();

// createClient must return the SAME object every call (singleton pattern matches real implementation)
const mockSupabase = {
  channel: mockChannel,
  removeChannel: mockRemoveChannel,
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => mockSupabase),
}));

mockChannel.mockReturnValue({
  on: mockOn.mockReturnValue({
    subscribe: mockSubscribe,
  }),
});

const { useRealtime } = await import("@/hooks/use-realtime");

describe("useRealtime", () => {
  const channelObj = { id: "test-channel" };

  beforeEach(() => {
    vi.clearAllMocks();
    // subscribe() must return a truthy channel object so channelRef.current is set
    mockSubscribe.mockReturnValue(channelObj);
    mockOn.mockReturnValue({ subscribe: mockSubscribe });
    mockChannel.mockReturnValue({ on: mockOn });
  });

  it("should subscribe to a channel on mount", () => {
    const onEvent = vi.fn();
    renderHook(() =>
      useRealtime({
        table: "listings",
        event: "INSERT",
        onEvent,
      })
    );

    expect(mockChannel).toHaveBeenCalledWith(expect.stringContaining("realtime:listings"));
    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "listings" }),
      expect.any(Function)
    );
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it("should clean up channel on unmount", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useRealtime({ table: "listings", onEvent }));

    unmount();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });

  it("should not subscribe when enabled is false", () => {
    const onEvent = vi.fn();
    renderHook(() =>
      useRealtime({
        table: "listings",
        onEvent,
        enabled: false,
      })
    );

    expect(mockChannel).not.toHaveBeenCalled();
  });

  it("should include filter when filterColumn and filterValue are provided", () => {
    const onEvent = vi.fn();
    renderHook(() =>
      useRealtime({
        table: "listings",
        event: "UPDATE",
        filterColumn: "user_id",
        filterValue: "abc-123",
        onEvent,
      })
    );

    expect(mockChannel).toHaveBeenCalledWith(expect.stringContaining("realtime:listings"));
    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        table: "listings",
        filter: expect.stringContaining("user_id"),
      }),
      expect.any(Function)
    );
  });
});

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

  it("uses separate channel topics for duplicate subscriptions", () => {
    const onEvent = vi.fn();
    renderHook(() =>
      useRealtime({
        table: "notifications",
        event: "INSERT",
        filterColumn: "user_id",
        filterValue: "user-123",
        onEvent,
      })
    );
    renderHook(() =>
      useRealtime({
        table: "notifications",
        event: "INSERT",
        filterColumn: "user_id",
        filterValue: "user-123",
        onEvent,
      })
    );

    const topics = mockChannel.mock.calls.map(([topic]) => topic);
    expect(topics[0]).toContain("realtime:notifications:INSERT:user_id=eq.user-123");
    expect(topics[1]).toContain("realtime:notifications:INSERT:user_id=eq.user-123");
    expect(topics[0]).not.toBe(topics[1]);
  });
});

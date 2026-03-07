import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

describe("use-debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should debounce value changes", async () => {
    const { useDebounceValue } = await import("@/hooks/use-debounce");

    const { result, rerender } = renderHook(({ value }) => useDebounceValue(value, 500), {
      initialProps: { value: "initial" },
    });

    expect(result.current).toBe("initial");

    rerender({ value: "updated" });
    expect(result.current).toBe("initial"); // Not yet updated

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe("updated");
  });

  it("should reset timer on rapid changes", async () => {
    const { useDebounceValue } = await import("@/hooks/use-debounce");

    const { result, rerender } = renderHook(({ value }) => useDebounceValue(value, 300), {
      initialProps: { value: "a" },
    });

    rerender({ value: "b" });
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: "c" });
    act(() => vi.advanceTimersByTime(200));

    // Still "a" because timer keeps resetting
    expect(result.current).toBe("a");

    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe("c"); // Final value
  });

  it("cancels a pending debounced callback", async () => {
    const { useDebouncedCallback } = await import("@/hooks/use-debounce");
    const callback = vi.fn();

    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    act(() => {
      result.current("queued");
      result.current.cancel();
      vi.advanceTimersByTime(300);
    });

    expect(callback).not.toHaveBeenCalled();
  });
});

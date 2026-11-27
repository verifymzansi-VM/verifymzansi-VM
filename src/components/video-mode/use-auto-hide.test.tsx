/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_HIDE_MS, useAutoHide } from "./use-auto-hide";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoHide", () => {
  it("hides the controls after 4 s of playback, not before", () => {
    expect(AUTO_HIDE_MS).toBe(4000);
    const { result } = renderHook(() => useAutoHide(true));
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(result.current.hidden).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.hidden).toBe(true);
  });

  it("never hides while paused or with a sheet open", () => {
    const { result } = renderHook(() => useAutoHide(false));
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(result.current.hidden).toBe(false);
  });

  it("shows everything again as soon as playback stops", () => {
    const { result, rerender } = renderHook(({ on }) => useAutoHide(on), {
      initialProps: { on: true },
    });
    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_MS);
    });
    expect(result.current.hidden).toBe(true);
    rerender({ on: false });
    expect(result.current.hidden).toBe(false);
  });

  it("starts the 4 s again on each touch while the controls show", () => {
    const { result } = renderHook(() => useAutoHide(true));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => {
      result.current.noteActivity();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.hidden).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.hidden).toBe(true);
  });

  it("a tap while hidden brings the controls back without counting as a pause", () => {
    const { result } = renderHook(() => useAutoHide(true));
    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_MS);
    });
    let used = false;
    act(() => {
      used = result.current.revealOnTap();
    });
    expect(used).toBe(true);
    expect(result.current.hidden).toBe(false);
    // The next tap, with the controls showing, is a normal tap (it pauses).
    act(() => {
      used = result.current.revealOnTap();
    });
    expect(used).toBe(false);
    // And the controls fade again 4 s after the reveal.
    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_MS);
    });
    expect(result.current.hidden).toBe(true);
  });

  it("keeps the controls while a keyboard user is on one", () => {
    const button = document.createElement("button");
    const chrome = document.createElement("div");
    chrome.setAttribute("data-vm-chrome", "");
    chrome.append(button);
    document.body.append(chrome);
    button.focus();
    const matches = vi.spyOn(button, "matches").mockReturnValue(true);
    const { result } = renderHook(() => useAutoHide(true));
    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_MS * 2);
    });
    expect(result.current.hidden).toBe(false);
    matches.mockRestore();
    chrome.remove();
  });
});

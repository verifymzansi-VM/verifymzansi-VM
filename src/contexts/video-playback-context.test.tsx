/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { VideoPlaybackProvider, useVideoPlaybackManager } from "@/contexts/video-playback-context";

/* ------------------------------------------------------------------ */
/*  HTMLMediaElement stubs                                             */
/* ------------------------------------------------------------------ */

function makeVideo(id: string): HTMLVideoElement {
  const el = document.createElement("video");
  el.setAttribute("data-testid", id);
  // jsdom doesn't implement play/pause — stub them with paused state tracking
  let paused = true;
  Object.defineProperty(el, "paused", {
    get: () => paused,
    configurable: true,
  });
  Object.defineProperty(el, "src", {
    value: `https://example.com/${id}.mp4`,
    writable: true,
    configurable: true,
  });
  el.play = vi.fn(() => {
    paused = false;
    el.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  el.pause = vi.fn(() => {
    paused = true;
  });
  return el;
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <VideoPlaybackProvider>{children}</VideoPlaybackProvider>;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("VideoPlaybackContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("picks the most visible video after debounce", async () => {
    const { result } = renderHook(() => useVideoPlaybackManager(), { wrapper });
    const manager = result.current;

    const a = makeVideo("a");
    const b = makeVideo("b");

    act(() => {
      manager.register(a);
      manager.register(b);
      manager.updateVisibility(a, 0.5);
      manager.updateVisibility(b, 0.8);
    });

    // Not yet — debounce is 80ms
    expect(b.play).not.toHaveBeenCalled();

    // Flush fake timers then resolve microtasks (play() promise)
    vi.advanceTimersByTime(100);
    await act(async () => {
      await Promise.resolve();
    });

    expect(b.play).toHaveBeenCalled();
  });

  it("does not play any video below 25% visibility", async () => {
    const { result } = renderHook(() => useVideoPlaybackManager(), { wrapper });
    const manager = result.current;

    const a = makeVideo("a");

    act(() => {
      manager.register(a);
      manager.updateVisibility(a, 0.2);
    });
    vi.advanceTimersByTime(100);
    await act(async () => {
      await Promise.resolve();
    });

    expect(a.play).not.toHaveBeenCalled();
  });

  it("requestPriority overrides visibility-based winner", async () => {
    const { result } = renderHook(() => useVideoPlaybackManager(), { wrapper });
    const manager = result.current;

    const a = makeVideo("a");
    const b = makeVideo("b");

    act(() => {
      manager.register(a);
      manager.register(b);
      manager.updateVisibility(a, 0.9);
      manager.updateVisibility(b, 0.3);
    });
    vi.advanceTimersByTime(100);
    await act(async () => {
      await Promise.resolve();
    });
    expect(a.play).toHaveBeenCalled();

    // b takes priority (e.g. hover)
    act(() => manager.requestPriority(b));

    expect(b.play).toHaveBeenCalled();
    expect(a.pause).toHaveBeenCalled();
  });

  it("releasePriority re-arbitrates to most visible", async () => {
    const { result } = renderHook(() => useVideoPlaybackManager(), { wrapper });
    const manager = result.current;

    const a = makeVideo("a");
    const b = makeVideo("b");

    act(() => {
      manager.register(a);
      manager.register(b);
      manager.updateVisibility(a, 0.9);
      manager.updateVisibility(b, 0.3);
    });
    vi.advanceTimersByTime(100);
    await act(async () => {
      await Promise.resolve();
    });

    act(() => manager.requestPriority(b));
    act(() => manager.releasePriority(b));
    vi.advanceTimersByTime(100);
    await act(async () => {
      await Promise.resolve();
    });

    // a should win again (higher visibility)
    expect(a.play).toHaveBeenCalledTimes(2);
  });

  /* ------ claimExclusive / releaseExclusive ------ */

  it("claimExclusive pauses ALL managed videos immediately", async () => {
    const { result } = renderHook(() => useVideoPlaybackManager(), { wrapper });
    const manager = result.current;

    const a = makeVideo("a");
    const b = makeVideo("b");

    act(() => {
      manager.register(a);
      manager.register(b);
      manager.updateVisibility(a, 0.9);
      manager.updateVisibility(b, 0.5);
    });
    vi.advanceTimersByTime(100);
    await act(async () => {
      await Promise.resolve();
    });

    // a is playing
    expect(a.play).toHaveBeenCalled();

    // Claim exclusive (e.g. lightbox opens)
    act(() => manager.claimExclusive("lightbox"));

    expect(a.pause).toHaveBeenCalled();
  });

  it("claimExclusive blocks arbitration (no auto-play during lock)", async () => {
    const { result } = renderHook(() => useVideoPlaybackManager(), { wrapper });
    const manager = result.current;

    const a = makeVideo("a");

    act(() => {
      manager.register(a);
      manager.claimExclusive("lightbox");
    });

    act(() => {
      manager.updateVisibility(a, 1.0);
    });
    vi.advanceTimersByTime(200);
    await act(async () => {
      await Promise.resolve();
    });

    // Even with full visibility, should not play because exclusive lock is held
    expect(a.play).not.toHaveBeenCalled();
  });

  it("releaseExclusive re-arbitrates and resumes most visible", async () => {
    const { result } = renderHook(() => useVideoPlaybackManager(), { wrapper });
    const manager = result.current;

    const a = makeVideo("a");
    const b = makeVideo("b");

    act(() => {
      manager.register(a);
      manager.register(b);
      manager.updateVisibility(a, 0.9);
      manager.updateVisibility(b, 0.4);
    });
    vi.advanceTimersByTime(100);
    await act(async () => {
      await Promise.resolve();
    });
    expect(a.play).toHaveBeenCalledTimes(1);

    act(() => manager.claimExclusive("lightbox"));

    // Reset call counts to verify post-release behavior
    (a.play as ReturnType<typeof vi.fn>).mockClear();
    (b.play as ReturnType<typeof vi.fn>).mockClear();

    act(() => manager.releaseExclusive("lightbox"));
    vi.advanceTimersByTime(100);
    await act(async () => {
      await Promise.resolve();
    });

    // a should resume (highest visibility)
    expect(a.play).toHaveBeenCalled();
    expect(b.play).not.toHaveBeenCalled();
  });

  it("releaseExclusive with wrong id does not release the lock", async () => {
    const { result } = renderHook(() => useVideoPlaybackManager(), { wrapper });
    const manager = result.current;

    const a = makeVideo("a");

    act(() => {
      manager.register(a);
      manager.updateVisibility(a, 0.9);
      manager.claimExclusive("lightbox");
    });

    act(() => manager.releaseExclusive("wrong-id"));
    vi.advanceTimersByTime(200);
    await act(async () => {
      await Promise.resolve();
    });

    // Lock still held — no play
    expect(a.play).not.toHaveBeenCalled();
  });

  it("unregister during exclusive lock does not crash", () => {
    const { result } = renderHook(() => useVideoPlaybackManager(), { wrapper });
    const manager = result.current;

    const a = makeVideo("a");

    act(() => {
      manager.register(a);
      manager.claimExclusive("lightbox");
    });

    // Should not throw
    expect(() => {
      act(() => manager.unregister(a));
    }).not.toThrow();
  });

  it("claimExclusive cancels pending debounced arbitration", async () => {
    const { result } = renderHook(() => useVideoPlaybackManager(), { wrapper });
    const manager = result.current;

    const a = makeVideo("a");

    act(() => {
      manager.register(a);
      manager.updateVisibility(a, 0.9);
      // updateVisibility schedules arbitration in 80ms
      // Immediately claim exclusive — should cancel the pending timer
      manager.claimExclusive("lightbox");
    });

    vi.advanceTimersByTime(200);
    await act(async () => {
      await Promise.resolve();
    });

    // Even after waiting, a should not play because exclusive was claimed before arbitration ran
    expect(a.play).not.toHaveBeenCalled();
  });
});

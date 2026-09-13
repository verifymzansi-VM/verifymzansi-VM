/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalMute } from "./use-global-mute";
import { useVideoMuteStore } from "@/stores/video-mute-store";

describe("useGlobalMute", () => {
  beforeEach(() => useVideoMuteStore.setState({ isMuted: true }));

  it("changes audio synchronously on all cards without changing playback", () => {
    const playing = document.createElement("video");
    const paused = document.createElement("video");
    Object.defineProperty(playing, "paused", { value: false });
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    playing.currentTime = 12;
    paused.currentTime = 7;
    renderHook(() => useGlobalMute({ current: playing }));
    const { result, unmount } = renderHook(() => useGlobalMute({ current: paused }));

    act(() => {
      result.current.toggleMute();
      // Assert before React flushes effects: Safari requires the user gesture.
      expect(playing.muted).toBe(false);
      expect(paused.muted).toBe(false);
    });
    act(() => result.current.toggleMute());
    expect(playing.muted).toBe(true);
    expect(paused.muted).toBe(true);
    expect(playing.paused).toBe(false);
    expect(paused.paused).toBe(true);
    expect(playing.currentTime).toBe(12);
    expect(paused.currentTime).toBe(7);
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    unmount();
    act(() => useVideoMuteStore.getState().toggleMute());
    expect(paused.muted).toBe(true);
    play.mockRestore();
    pause.mockRestore();
  });
});

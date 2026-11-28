/** @vitest-environment jsdom */
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useRef, useState } from "react";
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

  it("follows the current element when the video is replaced (a photo slide, then a keyed video)", () => {
    function Gallery() {
      const videoRef = useRef<HTMLVideoElement>(null);
      const [slide, setSlide] = useState<"photo" | "a.mp4" | "b.mp4">("photo");
      const { isMuted, toggleMute } = useGlobalMute(videoRef);
      return (
        <>
          {slide !== "photo" && <video key={slide} ref={videoRef} data-testid="video" muted />}
          <button onClick={() => setSlide(slide === "photo" ? "a.mp4" : "b.mp4")}>Next</button>
          <button onClick={toggleMute}>{isMuted ? "Turn sound on" : "Turn sound off"}</button>
        </>
      );
    }
    render(<Gallery />);
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Turn sound on"));
    expect((screen.getByTestId("video") as HTMLVideoElement).muted).toBe(false);
    // A new element starts muted from its attribute and takes the setting.
    fireEvent.click(screen.getByText("Next"));
    expect((screen.getByTestId("video") as HTMLVideoElement).muted).toBe(false);
    fireEvent.click(screen.getByText("Turn sound off"));
    expect((screen.getByTestId("video") as HTMLVideoElement).muted).toBe(true);
  });
});

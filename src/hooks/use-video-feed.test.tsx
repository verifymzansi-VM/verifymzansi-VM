/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VideoPlaybackProvider } from "@/contexts/video-playback-context";
import { useVideoFeed } from "./use-video-feed";

vi.mock("./use-reduced-motion", () => ({ useReducedMotion: () => false }));
vi.mock("./use-data-saver", () => ({ useDataSaver: () => false }));
let observe: IntersectionObserverCallback;
function Probe() {
  const { videoRef, isPlaying, togglePlayback } = useVideoFeed("https://example.com/clip.mp4");
  return (
    <>
      <video ref={videoRef} />
      <button onClick={togglePlayback}>{isPlaying ? "Pause" : "Play"}</button>
    </>
  );
}
function visibility(ratio: number) {
  act(() => {
    observe(
      [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
    vi.advanceTimersByTime(100);
  });
}

describe("mobile feed playback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observe = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    const playing = new WeakSet<HTMLMediaElement>();
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (
      this: HTMLMediaElement
    ) {
      return !playing.has(this);
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement
    ) {
      playing.add(this);
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
      this: HTMLMediaElement
    ) {
      playing.delete(this);
      this.dispatchEvent(new Event("pause"));
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps a manual pause through visibility changes and resumes on tap", () => {
    render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    visibility(0.5);
    expect(document.querySelector("video")!.paused).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(document.querySelector("video")!.paused).toBe(false);
  });

  it("stops manually started video below 25 percent visibility", () => {
    render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    visibility(0.2);
    expect(document.querySelector("video")!.paused).toBe(true);
    visibility(0.75);
    expect(document.querySelector("video")!.paused).toBe(false);
  });
});

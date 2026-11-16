/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VideoPlaybackProvider } from "@/contexts/video-playback-context";
import { useVideoAutoplayStore } from "@/stores/video-autoplay-store";
import { useVideoFeed } from "./use-video-feed";

vi.mock("./use-reduced-motion", () => ({ useReducedMotion: () => false }));
vi.mock("./use-data-saver", () => ({ useDataSaver: () => false }));
let observers: IntersectionObserverCallback[] = [];
function Probe({
  src = "https://example.com/clip.mp4",
  eligible = true,
  label = "",
}: {
  src?: string;
  eligible?: boolean;
  label?: string;
}) {
  const { videoRef, isPlaying, togglePlayback } = useVideoFeed(src, eligible);
  return (
    <>
      <video ref={videoRef} data-testid={`video${label}`} />
      <button onClick={togglePlayback}>
        {isPlaying ? "Pause" : "Preview"}
        {label}
      </button>
    </>
  );
}
function visibility(ratio: number) {
  act(() => {
    for (const observe of observers) {
      observe(
        [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    }
    vi.advanceTimersByTime(100);
  });
}

describe("touch feed card preview", () => {
  beforeEach(() => {
    observers = [];
    useVideoAutoplayStore.setState({ autoplayEnabled: false });
    vi.useFakeTimers();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observers.push(callback);
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

  it("never plays or loads a visible card by itself", () => {
    render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    visibility(1);
    const video = screen.getByTestId("video");
    expect(video.getAttribute("src")).toBeNull();
    expect(video).toHaveProperty("paused", true);
  });

  it("does not autoplay even after the shared showroom intent is on", () => {
    useVideoAutoplayStore.setState({ autoplayEnabled: true });
    render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    visibility(1);
    expect(screen.getByTestId("video").getAttribute("src")).toBeNull();
    expect(screen.getByTestId("video")).toHaveProperty("paused", true);
  });

  it("plays inline when Preview is pressed, and only that card", () => {
    render(
      <VideoPlaybackProvider>
        <Probe label="A" />
        <Probe label="B" src="https://example.com/other.mp4" />
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    fireEvent.click(screen.getByRole("button", { name: "PreviewB" }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("videoB")).toHaveProperty("paused", false);
    expect(screen.getByTestId("videoB").getAttribute("src")).toBe("https://example.com/other.mp4");
    expect(screen.getByTestId("videoA")).toHaveProperty("paused", true);
    expect(screen.getByTestId("videoA").getAttribute("src")).toBeNull();
  });

  it("leaves the shared showroom intent alone", () => {
    render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(useVideoAutoplayStore.getState().autoplayEnabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(useVideoAutoplayStore.getState().autoplayEnabled).toBe(false);
  });

  it("keeps a preview playing while the card stays in view", () => {
    render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    visibility(0.5);
    expect(screen.getByTestId("video")).toHaveProperty("paused", false);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByTestId("video")).toHaveProperty("paused", true);
  });

  it("stops a preview below 25 percent visibility and does not resume by itself", () => {
    render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    visibility(0.2);
    expect(screen.getByTestId("video")).toHaveProperty("paused", true);
    visibility(0.75);
    expect(screen.getByTestId("video")).toHaveProperty("paused", true);
  });

  it("stops a preview when the card is no longer the focused card of its rail", () => {
    const { rerender } = render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByTestId("video")).toHaveProperty("paused", false);
    rerender(
      <VideoPlaybackProvider>
        <Probe eligible={false} />
      </VideoPlaybackProvider>
    );
    expect(screen.getByTestId("video")).toHaveProperty("paused", true);
  });

  it("loads the replacement source when a reused card is previewed", () => {
    const { rerender } = render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    rerender(
      <VideoPlaybackProvider>
        <Probe src="https://example.com/new.mp4" />
      </VideoPlaybackProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByTestId("video").getAttribute("src")).toBe("https://example.com/new.mp4");
  });
});

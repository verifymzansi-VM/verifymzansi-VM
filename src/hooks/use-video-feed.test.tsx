/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VideoPlaybackProvider } from "@/contexts/video-playback-context";
import { AutoplayPolicyProvider } from "@/contexts/autoplay-policy-context";
import { useVideoAutoplayStore } from "@/stores/video-autoplay-store";
import { useVideoFeed } from "./use-video-feed";

vi.mock("./use-reduced-motion", () => ({ useReducedMotion: () => false }));
vi.mock("./use-data-saver", () => ({ useDataSaver: () => false }));
let observe: IntersectionObserverCallback;
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
        {isPlaying ? "Pause" : "Play"}
        {label}
      </button>
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
  it("loads the replacement source when a card is reused", () => {
    const { rerender } = render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    rerender(
      <VideoPlaybackProvider>
        <Probe src="https://example.com/new.mp4" />
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    expect(document.querySelector("video")!.src).toBe("https://example.com/new.mp4");
  });

  it("lets an inactive carousel card play and pause manually through visibility and focus changes", () => {
    const { rerender } = render(
      <VideoPlaybackProvider>
        <Probe eligible={false} />
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    expect(document.querySelector("video")!.paused).toBe(true);
    expect(document.querySelector("video")!.getAttribute("src")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(document.querySelector("video")!.paused).toBe(false);
    visibility(0.5);
    expect(document.querySelector("video")!.paused).toBe(false);
    rerender(
      <VideoPlaybackProvider>
        <Probe eligible />
      </VideoPlaybackProvider>
    );
    expect(document.querySelector("video")!.paused).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    visibility(0.75);
    expect(document.querySelector("video")!.paused).toBe(true);
  });

  beforeEach(() => {
    useVideoAutoplayStore.setState({ autoplayEnabled: true });
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

  it("skips autoplay when the page disables autoplay (mobile policy)", () => {
    useVideoAutoplayStore.setState({ autoplayEnabled: false });
    render(
      <VideoPlaybackProvider>
        <AutoplayPolicyProvider disableAutoplay>
          <Probe />
        </AutoplayPolicyProvider>
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    const video = document.querySelector("video")!;
    expect(video.getAttribute("src")).toBeNull();
    expect(video.paused).toBe(true);
  });

  it("keeps the tapped card playing when the first Play lifts the mobile policy", () => {
    useVideoAutoplayStore.setState({ autoplayEnabled: false });
    render(
      <VideoPlaybackProvider>
        <AutoplayPolicyProvider disableAutoplay>
          <Probe label="A" />
          <Probe label="B" src="https://example.com/other.mp4" />
        </AutoplayPolicyProvider>
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    fireEvent.click(screen.getByRole("button", { name: "PlayB" }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("videoB")).toHaveProperty("paused", false);
    expect(screen.getByTestId("videoA")).toHaveProperty("paused", true);
  });

  it("autoplays under the mobile policy once the user has pressed play", () => {
    render(
      <VideoPlaybackProvider>
        <AutoplayPolicyProvider disableAutoplay>
          <Probe />
        </AutoplayPolicyProvider>
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    const video = document.querySelector("video")!;
    expect(video.src).toBe("https://example.com/clip.mp4");
    expect(video.paused).toBe(false);
  });

  it("loads a visible card when it becomes eligible without another intersection", () => {
    const { rerender } = render(
      <VideoPlaybackProvider>
        <Probe eligible={false} />
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    expect(document.querySelector("video")!.getAttribute("src")).toBeNull();
    rerender(
      <VideoPlaybackProvider>
        <Probe eligible />
      </VideoPlaybackProvider>
    );
    expect(document.querySelector("video")!.src).toBe("https://example.com/clip.mp4");
  });

  it("does not autoplay any card until the user presses play", () => {
    useVideoAutoplayStore.setState({ autoplayEnabled: false });
    render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    visibility(0.75);
    const video = document.querySelector("video")!;
    expect(video.getAttribute("src")).toBeNull();
    expect(video.paused).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(video.paused).toBe(false);
    expect(useVideoAutoplayStore.getState().autoplayEnabled).toBe(true);
  });

  it("pausing one card stops every card and keeps autoplay off", () => {
    render(
      <VideoPlaybackProvider>
        <Probe label="A" />
        <Probe label="B" src="https://example.com/other.mp4" />
      </VideoPlaybackProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "PlayB" }));
    expect(screen.getByTestId("videoB")).toHaveProperty("paused", false);
    fireEvent.click(screen.getByRole("button", { name: "PauseB" }));
    expect(useVideoAutoplayStore.getState().autoplayEnabled).toBe(false);
    visibility(0.75);
    expect(screen.getByTestId("videoA")).toHaveProperty("paused", true);
    expect(screen.getByTestId("videoB")).toHaveProperty("paused", true);
  });

  it("stops a playing card when pause is pressed on another card", () => {
    render(
      <VideoPlaybackProvider>
        <Probe />
      </VideoPlaybackProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(document.querySelector("video")!.paused).toBe(false);
    act(() => useVideoAutoplayStore.getState().setAutoplayEnabled(false));
    expect(document.querySelector("video")!.paused).toBe(true);
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

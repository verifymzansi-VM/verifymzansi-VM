/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useVideoVisibility } from "./use-video-visibility";
import { VideoPlaybackProvider } from "@/contexts/video-playback-context";

const { reducedMotionMock } = vi.hoisted(() => ({
  reducedMotionMock: vi.fn(),
}));

vi.mock("./use-reduced-motion", () => ({
  useReducedMotion: reducedMotionMock,
}));

let observerCallback: IntersectionObserverCallback | undefined;

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback;
  }

  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
}

function Probe({ videoSrc }: { videoSrc?: string }) {
  const { videoRef } = useVideoVisibility(videoSrc);
  return <video ref={videoRef} />;
}

function renderProbe(videoSrc?: string) {
  return render(
    <VideoPlaybackProvider>
      <Probe videoSrc={videoSrc} />
    </VideoPlaybackProvider>
  );
}

describe("useVideoVisibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    observerCallback = undefined;
    reducedMotionMock.mockReturnValue(false);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads and plays the video when it becomes visible", async () => {
    const { container } = renderProbe("https://example.com/demo.mp4");
    const video = container.querySelector("video");
    expect(video).toBeTruthy();

    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined as never);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    observerCallback?.(
      [
        {
          isIntersecting: true,
          intersectionRatio: 0.5,
          target: video as Element,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver
    );

    expect(video?.getAttribute("src")).toContain("https://example.com/demo.mp4");

    // The playback manager debounces arbitration by 80ms
    vi.advanceTimersByTime(100);
    expect(playSpy).toHaveBeenCalled();

    observerCallback?.(
      [
        {
          isIntersecting: false,
          intersectionRatio: 0,
          target: video as Element,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver
    );

    expect(pauseSpy).toHaveBeenCalled();
  });

  it("skips autoplay when reduced motion is enabled", () => {
    reducedMotionMock.mockReturnValue(true);
    const { container } = renderProbe("https://example.com/demo.mp4");
    const video = container.querySelector("video");
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined as never);

    observerCallback?.(
      [
        {
          isIntersecting: true,
          intersectionRatio: 0.5,
          target: video as Element,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver
    );

    expect(video?.getAttribute("src")).toContain("https://example.com/demo.mp4");
    vi.advanceTimersByTime(100);
    expect(playSpy).not.toHaveBeenCalled();
  });
});

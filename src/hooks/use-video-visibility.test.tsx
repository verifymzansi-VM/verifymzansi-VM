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
let observerThresholds: ReadonlyArray<number> | undefined;

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    observerCallback = callback;
    if (Array.isArray(options?.threshold)) {
      observerThresholds = options.threshold;
    } else if (typeof options?.threshold === "number") {
      observerThresholds = [options.threshold];
    } else {
      observerThresholds = undefined;
    }
  }

  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
}

function Probe({
  videoSrc,
  autoplay = true,
  manual = false,
}: {
  videoSrc?: string;
  autoplay?: boolean;
  manual?: boolean;
}) {
  const { videoRef } = useVideoVisibility(videoSrc, autoplay, manual);
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
  it("keeps its registration when resuming and permits explicit reduced-motion playback", () => {
    reducedMotionMock.mockReturnValue(true);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { container, rerender } = render(
      <VideoPlaybackProvider>
        <Probe videoSrc="/clip.mp4" autoplay={false} />
      </VideoPlaybackProvider>
    );
    const video = container.querySelector("video")!;
    const observer = observerCallback;
    const pause = vi.spyOn(video, "pause");
    pause.mockClear();
    rerender(
      <VideoPlaybackProvider>
        <Probe videoSrc="/clip.mp4" manual />
      </VideoPlaybackProvider>
    );
    expect(observerCallback).toBe(observer);
    expect(pause).not.toHaveBeenCalled();
    observerCallback?.(
      [
        {
          target: video,
          isIntersecting: true,
          intersectionRatio: 0.8,
          boundingClientRect: {} as DOMRectReadOnly,
          intersectionRect: {} as DOMRectReadOnly,
          rootBounds: null,
          time: 0,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver
    );
    expect(pause).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    observerCallback = undefined;
    observerThresholds = undefined;
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

  it("configures visibility thresholds with 15% as first autoplay trigger", () => {
    renderProbe("https://example.com/demo.mp4");

    expect(observerThresholds).toEqual([0, 0.15, 0.5, 0.75, 1]);
  });
});

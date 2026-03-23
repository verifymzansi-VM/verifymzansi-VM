/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useVideoVisibility } from "./use-video-visibility";

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

describe("useVideoVisibility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    observerCallback = undefined;
    reducedMotionMock.mockReturnValue(false);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  it("loads and plays the video when it becomes visible", async () => {
    const { container } = render(<Probe videoSrc="https://example.com/demo.mp4" />);
    const video = container.querySelector("video");
    expect(video).toBeTruthy();

    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined as never);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    observerCallback?.(
      [{ isIntersecting: true, target: video as Element } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );

    expect(video?.getAttribute("src")).toContain("https://example.com/demo.mp4");
    expect(playSpy).toHaveBeenCalled();

    observerCallback?.(
      [{ isIntersecting: false, target: video as Element } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );

    expect(pauseSpy).toHaveBeenCalled();
  });

  it("skips autoplay when reduced motion is enabled", () => {
    reducedMotionMock.mockReturnValue(true);
    const { container } = render(<Probe videoSrc="https://example.com/demo.mp4" />);
    const video = container.querySelector("video");
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined as never);

    observerCallback?.(
      [{ isIntersecting: true, target: video as Element } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );

    expect(video?.getAttribute("src")).toContain("https://example.com/demo.mp4");
    expect(playSpy).not.toHaveBeenCalled();
  });
});

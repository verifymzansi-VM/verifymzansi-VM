import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoHover } from "@/hooks/use-video-hover";

const useReducedMotionMock = vi.fn();
const useVideoPlaybackManagerMock = vi.fn();

vi.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => useReducedMotionMock(),
}));

vi.mock("@/contexts/video-playback-context", () => ({
  useVideoPlaybackManager: () => useVideoPlaybackManagerMock(),
}));

describe("useVideoHover", () => {
  let intersectionCallback: IntersectionObserverCallback | null = null;

  function createIntersectionEntry(
    target: Element,
    overrides: Partial<IntersectionObserverEntry> = {}
  ): IntersectionObserverEntry {
    return {
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRatio: 1,
      intersectionRect: target.getBoundingClientRect(),
      isIntersecting: true,
      rootBounds: null,
      target,
      time: 0,
      ...overrides,
    };
  }

  function Harness({ src }: { src?: string }) {
    const { videoRef, containerRef, togglePlayback } = useVideoHover(src);
    return (
      <div data-testid="container" ref={containerRef}>
        <video data-testid="video" ref={videoRef} />
        <button onClick={togglePlayback}>Toggle</button>
      </div>
    );
  }

  beforeEach(() => {
    const observe = vi.fn();
    const disconnect = vi.fn();

    class MockIntersectionObserver {
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);

      constructor(cb: IntersectionObserverCallback) {
        intersectionCallback = cb;
      }
    }

    globalThis.IntersectionObserver = MockIntersectionObserver as never;
  });

  it.each([false, true])(
    "registers video and plays on hover with a shared card frame: %s",
    (sharedFrame) => {
      const manager = {
        register: vi.fn(),
        unregister: vi.fn(),
        updateVisibility: vi.fn(),
        requestPriority: vi.fn(),
        releasePriority: vi.fn(),
        claimExclusive: vi.fn(),
        releaseExclusive: vi.fn(),
      };
      useReducedMotionMock.mockReturnValue(false);
      useVideoPlaybackManagerMock.mockReturnValue(manager);

      const { getByTestId, unmount } = render(
        sharedFrame ? (
          <div data-card-variant="showcase" data-testid="frame">
            <Harness src="/media/clip.mp4" />
          </div>
        ) : (
          <Harness src="/media/clip.mp4" />
        )
      );

      const video = getByTestId("video") as HTMLVideoElement;
      const container = getByTestId(sharedFrame ? "frame" : "container") as HTMLDivElement;
      const pauseSpy = vi.spyOn(video, "pause").mockImplementation(() => undefined);

      expect(manager.register).toHaveBeenCalledWith(video);

      // First hover can precede the initial visibility callback.
      act(() => container.dispatchEvent(new Event("mouseenter")));
      expect(video.src).toContain("/media/clip.mp4");
      expect(manager.requestPriority).toHaveBeenCalledWith(video);
      manager.requestPriority.mockClear();

      act(() => {
        intersectionCallback?.([createIntersectionEntry(video)], {} as IntersectionObserver);
      });

      expect(video.src).toContain("/media/clip.mp4");

      act(() => {
        container.dispatchEvent(new Event("mouseenter"));
      });
      expect(manager.requestPriority).toHaveBeenCalledWith(video);

      video.currentTime = 9;
      act(() => {
        container.dispatchEvent(new Event("mouseleave"));
      });
      expect(pauseSpy).toHaveBeenCalled();
      expect(video.currentTime).toBe(0);
      expect(manager.releasePriority).toHaveBeenCalledWith(video);

      unmount();
      expect(manager.unregister).toHaveBeenCalledWith(video);
    }
  );

  it("does not request priority on mouse enter when reduced motion is enabled", () => {
    const manager = {
      register: vi.fn(),
      unregister: vi.fn(),
      updateVisibility: vi.fn(),
      requestPriority: vi.fn(),
      releasePriority: vi.fn(),
      claimExclusive: vi.fn(),
      releaseExclusive: vi.fn(),
    };
    useReducedMotionMock.mockReturnValue(true);
    useVideoPlaybackManagerMock.mockReturnValue(manager);

    const { getByTestId } = render(<Harness src="/media/clip.mp4" />);

    const video = getByTestId("video") as HTMLVideoElement;
    video.src = "/media/clip.mp4";
    const container = getByTestId("container") as HTMLDivElement;

    act(() => {
      container.dispatchEvent(new Event("mouseenter"));
    });

    expect(manager.requestPriority).not.toHaveBeenCalled();
  });

  it("pauses and reports zero visibility when the video leaves the viewport", () => {
    const manager = {
      register: vi.fn(),
      unregister: vi.fn(),
      updateVisibility: vi.fn(),
      requestPriority: vi.fn(),
      releasePriority: vi.fn(),
      claimExclusive: vi.fn(),
      releaseExclusive: vi.fn(),
    };
    useReducedMotionMock.mockReturnValue(false);
    useVideoPlaybackManagerMock.mockReturnValue(manager);

    const { getByTestId } = render(<Harness src="/media/clip.mp4" />);
    const video = getByTestId("video") as HTMLVideoElement;
    const pauseSpy = vi.spyOn(video, "pause").mockImplementation(() => undefined);

    act(() => {
      intersectionCallback?.(
        [createIntersectionEntry(video, { isIntersecting: false, intersectionRatio: 0 })],
        {} as IntersectionObserver
      );
    });

    expect(pauseSpy).toHaveBeenCalled();
    expect(manager.updateVisibility).toHaveBeenCalledWith(video, 0);
  });

  it("no-ops registration when video source is not provided", () => {
    const manager = {
      register: vi.fn(),
      unregister: vi.fn(),
      updateVisibility: vi.fn(),
      requestPriority: vi.fn(),
      releasePriority: vi.fn(),
      claimExclusive: vi.fn(),
      releaseExclusive: vi.fn(),
    };
    useReducedMotionMock.mockReturnValue(false);
    useVideoPlaybackManagerMock.mockReturnValue(manager);

    render(<Harness src={undefined} />);

    expect(manager.register).not.toHaveBeenCalled();
  });

  it("preserves manual play and pause when the pointer leaves and re-enters", () => {
    const manager = {
      register: vi.fn(),
      unregister: vi.fn(),
      updateVisibility: vi.fn(),
      requestPriority: vi.fn(),
      releasePriority: vi.fn(),
    };
    useReducedMotionMock.mockReturnValue(false);
    useVideoPlaybackManagerMock.mockReturnValue(manager);
    const { getByTestId, getByRole } = render(<Harness src="/media/clip.mp4" />);
    const video = getByTestId("video") as HTMLVideoElement;
    const container = getByTestId("container");
    const paused = vi.spyOn(video, "paused", "get").mockReturnValue(true);
    const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);
    pause.mockClear();
    fireEvent.click(getByRole("button"));
    expect(manager.requestPriority).toHaveBeenCalledTimes(1);
    video.currentTime = 9;
    fireEvent.mouseLeave(container);
    expect(pause).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(9);
    paused.mockReturnValue(false);
    fireEvent.click(getByRole("button"));
    act(() => {
      container.dispatchEvent(new Event("mouseleave"));
      container.dispatchEvent(new Event("mouseenter"));
    });
    expect(manager.requestPriority).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    paused.mockRestore();
    pause.mockRestore();
  });
});

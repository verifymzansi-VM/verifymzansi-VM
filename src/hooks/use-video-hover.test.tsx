import { act, render } from "@testing-library/react";
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

  function Harness({ src }: { src?: string }) {
    const { videoRef, containerRef } = useVideoHover(src);
    return (
      <div data-testid="container" ref={containerRef}>
        <video data-testid="video" ref={videoRef} />
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

  it("registers video and requests priority on mouse enter when motion is allowed", () => {
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

    const { getByTestId, unmount } = render(<Harness src="/media/clip.mp4" />);

    const video = getByTestId("video") as HTMLVideoElement;
    const container = getByTestId("container") as HTMLDivElement;
    const pauseSpy = vi.spyOn(video, "pause").mockImplementation(() => undefined);

    expect(manager.register).toHaveBeenCalledWith(video);

    act(() => {
      intersectionCallback?.(
        [
          {
            isIntersecting: true,
            intersectionRatio: 1,
            target: video,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
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
  });

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
});

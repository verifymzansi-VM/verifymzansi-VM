/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileVideoPlayer } from "./profile-video-player";

const managerMock = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  updateVisibility: vi.fn(),
  requestPriority: vi.fn(),
  releasePriority: vi.fn(),
  claimExclusive: vi.fn(),
  releaseExclusive: vi.fn(),
}));
const preferences = vi.hoisted(() => ({ reducedMotion: false, saveData: false }));

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    fill: _fill,
    sizes: _sizes,
    priority: _priority,
    ...props
  }: Record<string, unknown> & { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

vi.mock("@/hooks/use-global-mute", () => ({
  useGlobalMute: () => ({
    isMuted: true,
    toggleMute: vi.fn(),
    setMuted: vi.fn(),
  }),
}));

vi.mock("@/contexts/video-playback-context", () => ({
  useVideoPlaybackManager: () => managerMock,
}));

vi.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => preferences.reducedMotion,
}));
vi.mock("@/hooks/use-data-saver", () => ({ useDataSaver: () => preferences.saveData }));

describe("ProfileVideoPlayer", () => {
  let requestFullscreenMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    preferences.reducedMotion = false;
    preferences.saveData = false;

    class CompactResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}

      observe() {
        this.callback(
          [{ contentRect: { width: 320 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      }

      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", CompactResizeObserver);
    requestFullscreenMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: requestFullscreenMock,
    });
  });

  it("keeps a visible fullscreen control on compact portrait cards", () => {
    render(<ProfileVideoPlayer src="/video.mp4" title="Profile clip" poster="/poster.jpg" />);

    const fullscreenButton = screen.getByRole("button", { name: "Fullscreen" });
    const volumeSlider = screen.getByLabelText("Volume");
    const video = screen.getByLabelText("Profile clip video");

    expect(fullscreenButton).toBeInTheDocument();
    expect(volumeSlider).not.toHaveClass("sm:block");

    fireEvent.click(fullscreenButton);
    expect(requestFullscreenMock).toHaveBeenCalledWith();
    expect(video).toBeInTheDocument();
    expect(video).toHaveClass("object-contain");
  });

  it("uses a responsive R2 variant for the native video poster", () => {
    render(
      <ProfileVideoPlayer
        src="/video.mp4"
        title="Profile clip"
        poster="/api/media/serve/media/business/photo.webp"
      />
    );

    expect(screen.getByLabelText("Profile clip video")).toHaveAttribute(
      "poster",
      "/api/media/serve/media/business/photo.w800.webp"
    );
  });

  it("handles an asynchronous fullscreen failure without losing playback controls", async () => {
    requestFullscreenMock.mockRejectedValue(new Error("Permission denied"));
    render(<ProfileVideoPlayer src="/video.mp4" title="Profile clip" />);
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Fullscreen is unavailable")
    );
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
  });

  it("fullscreens the container so controls remain present", () => {
    render(<ProfileVideoPlayer src="/video.mp4" title="Profile clip" />);
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(requestFullscreenMock.mock.contexts[0]).toBe(
      screen.getByLabelText("Profile clip video player")
    );
  });

  it("does not intercept Space or playback shortcuts on focused buttons", () => {
    render(<ProfileVideoPlayer src="/video.mp4" title="Profile clip" />);
    const video = screen.getByLabelText("Profile clip video") as HTMLVideoElement;
    video.play = vi.fn().mockResolvedValue(undefined);
    const button = screen.getByRole("button", { name: "Fullscreen" });
    expect(fireEvent.keyDown(button, { key: " " })).toBe(true);
    expect(fireEvent.keyDown(button, { key: "k" })).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
  });

  it.each(["reducedMotion", "saveData"] as const)(
    "honours %s while allowing explicit playback",
    (preference) => {
      preferences[preference] = true;
      render(<ProfileVideoPlayer src="/video.mp4" title="Profile clip" />);
      const video = screen.getByLabelText("Profile clip video") as HTMLVideoElement;
      expect(managerMock.updateVisibility).toHaveBeenCalledWith(video, 0);
      video.play = vi.fn().mockResolvedValue(undefined);
      fireEvent.click(screen.getByRole("button", { name: "Play video" }));
      expect(video.play).toHaveBeenCalled();
    }
  );

  it("leaves browser modifier shortcuts available", () => {
    render(<ProfileVideoPlayer src="/video.mp4" title="Profile clip" />);
    const player = screen.getByLabelText("Profile clip video player");
    expect(fireEvent.keyDown(player, { key: "f", ctrlKey: true })).toBe(true);
    expect(requestFullscreenMock).not.toHaveBeenCalled();
  });

  it("holds mobile autoplay until the visitor plays the video", () => {
    const originalMatchMedia = window.matchMedia;
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    class VisibleIntersectionObserver {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, intersectionRatio: 1 } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        );
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", VisibleIntersectionObserver);

    try {
      const { container } = render(
        <ProfileVideoPlayer
          src="/video.mp4"
          title="Profile clip"
          poster="/poster.jpg"
          prioritizePoster
          autoPlayOnMobile={false}
        />
      );

      const video = screen.getByLabelText("Profile clip video") as HTMLVideoElement;
      expect(video).toHaveAttribute("preload", "none");
      expect(managerMock.updateVisibility).toHaveBeenCalledWith(video, 0);
      expect(container.querySelector("img")).toHaveAttribute("loading", "eager");
      expect(container.querySelector("img")).toHaveAttribute("fetchpriority", "high");

      video.play = vi.fn().mockResolvedValue(undefined);
      fireEvent.click(screen.getByRole("button", { name: "Play video" }));
      expect(managerMock.requestPriority).toHaveBeenCalledWith(video);
      expect(video.play).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
      vi.stubGlobal("IntersectionObserver", originalIntersectionObserver);
    }
  });

  it("resumes playback after a manual pause", () => {
    render(<ProfileVideoPlayer src="/video.mp4" title="Profile clip" poster="/poster.jpg" />);

    const video = screen.getByLabelText("Profile clip video") as HTMLVideoElement;
    let paused = false;
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => paused,
    });
    Object.defineProperty(video, "ended", {
      configurable: true,
      get: () => false,
    });

    const playMock = vi.fn(() => {
      paused = false;
      fireEvent.play(video);
      return Promise.resolve();
    });
    const pauseMock = vi.fn(() => {
      paused = true;
      fireEvent.pause(video);
    });
    video.play = playMock;
    video.pause = pauseMock;

    fireEvent.play(video);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(pauseMock).toHaveBeenCalled();
    expect(managerMock.updateVisibility).toHaveBeenCalledWith(video, 0);
    expect(managerMock.releasePriority).toHaveBeenCalledWith(video);

    fireEvent.click(screen.getByRole("button", { name: "Play video" }));

    expect(managerMock.requestPriority).toHaveBeenCalledWith(video);
    expect(playMock).toHaveBeenCalled();
  });
});

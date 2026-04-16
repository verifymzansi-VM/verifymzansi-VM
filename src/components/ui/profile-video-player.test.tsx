/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileVideoPlayer } from "./profile-video-player";

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
  useVideoPlaybackManager: () => ({
    register: vi.fn(),
    unregister: vi.fn(),
    updateVisibility: vi.fn(),
    requestPriority: vi.fn(),
    releasePriority: vi.fn(),
    claimExclusive: vi.fn(),
    releaseExclusive: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

describe("ProfileVideoPlayer", () => {
  let requestFullscreenMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
    Object.defineProperty(HTMLVideoElement.prototype, "requestFullscreen", {
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
  });
});

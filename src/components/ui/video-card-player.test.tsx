/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { useVideoVisibilityMock, useVideoHoverMock, useHoverCapabilityMock } = vi.hoisted(() => ({
  useVideoVisibilityMock: vi.fn(),
  useVideoHoverMock: vi.fn(),
  useHoverCapabilityMock: vi.fn(),
}));

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

vi.mock("@/hooks/use-video-visibility", () => ({
  useVideoVisibility: useVideoVisibilityMock,
}));

vi.mock("@/hooks/use-video-hover", () => ({
  useVideoHover: useVideoHoverMock,
}));

vi.mock("@/hooks/use-hover-capability", () => ({
  useHoverCapability: useHoverCapabilityMock,
}));

const { VideoCardPlayer } = await import("./video-card-player");

describe("VideoCardPlayer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    useHoverCapabilityMock.mockReturnValue(true);
    useVideoVisibilityMock.mockReturnValue({
      videoRef: { current: null },
      reducedMotion: false,
    });
    useVideoHoverMock.mockReturnValue({
      videoRef: { current: null },
      containerRef: { current: null },
      reducedMotion: false,
      isHovering: false,
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  it("renders ambient video previews muted with a persistent mute control", () => {
    render(
      <VideoCardPlayer
        src="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        alt="Clip"
        mode="ambient"
        muteControlVisibility="always"
      />
    );

    const video = document.querySelector("video");
    expect(video).toBeTruthy();
    expect((video as HTMLVideoElement).muted).toBe(true);
    expect(screen.getByRole("button", { name: /unmute/i })).toBeTruthy();
  });

  it("keeps the poster visible for reduced-motion users in ambient mode", () => {
    useVideoVisibilityMock.mockReturnValue({
      videoRef: { current: null },
      reducedMotion: true,
    });

    render(
      <VideoCardPlayer
        src="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        alt="Clip"
        mode="ambient"
        muteControlVisibility="always"
      />
    );

    expect(screen.getByAltText("Clip")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders images with full-cover styling", () => {
    render(<VideoCardPlayer src="https://example.com/photo.jpg" alt="Photo" mode="ambient" />);

    expect(screen.getByAltText("Photo")).toHaveClass("object-cover");
    expect(screen.getByAltText("Photo")).toHaveAttribute("data-media-fit", "cover");
  });

  it("falls back to touch-friendly ambient behavior when hover is unavailable", () => {
    useHoverCapabilityMock.mockReturnValue(false);

    render(
      <VideoCardPlayer
        src="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        alt="Clip"
        mode="hover"
        muteControlVisibility="always"
      />
    );

    expect(useVideoHoverMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /unmute/i })).toBeTruthy();
  });

  it("supports poster-first touch fallbacks for hover previews", () => {
    useHoverCapabilityMock.mockReturnValue(false);

    render(
      <VideoCardPlayer
        src="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        alt="Clip"
        mode="hover"
        touchPreviewBehavior="poster"
        muteControlVisibility="always"
      />
    );

    expect(useVideoHoverMock).not.toHaveBeenCalled();
    expect(useVideoVisibilityMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /play video/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /unmute/i })).toBeNull();
  });

  it("renders a play/pause toggle for ambient videos when requested", () => {
    render(
      <VideoCardPlayer
        src="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        alt="Clip"
        mode="ambient"
        showPlaybackControl
      />
    );

    expect(screen.getByRole("button", { name: /pause video/i })).toBeTruthy();
  });

  it("notifies callers when the ambient playback control pauses and resumes video", () => {
    const onPlaybackStateChange = vi.fn();

    render(
      <VideoCardPlayer
        src="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        alt="Clip"
        mode="ambient"
        showPlaybackControl
        onPlaybackStateChange={onPlaybackStateChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /pause video/i }));
    expect(onPlaybackStateChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: /play video/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /play video/i }));
    expect(onPlaybackStateChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: /pause video/i })).toBeTruthy();
  });

  it("switches extreme images to smart-fit presentation", () => {
    render(
      <VideoCardPlayer
        src="https://example.com/photo.jpg"
        alt="Photo"
        mode="ambient"
        fitStrategy="smart"
      />
    );

    const image = screen.getByAltText("Photo");
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 600 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 1800 });

    fireEvent.load(image);

    expect(screen.getByAltText("Photo")).toHaveAttribute("data-media-fit", "smart");
    expect(screen.getByAltText("Photo")).toHaveClass("object-contain");
  });

  it("applies smart-fit to video posters when the media would crop too aggressively", () => {
    render(
      <VideoCardPlayer
        src="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        alt="Clip"
        mode="ambient"
        fitStrategy="smart"
        muteControlVisibility="always"
      />
    );

    const poster = screen.getByAltText("Clip");
    Object.defineProperty(poster, "naturalWidth", { configurable: true, value: 2200 });
    Object.defineProperty(poster, "naturalHeight", { configurable: true, value: 900 });

    fireEvent.load(poster);

    expect(screen.getByAltText("Clip")).toHaveAttribute("data-media-fit", "smart");
    expect(screen.getByAltText("Clip")).toHaveClass("object-contain");
  });

  it("applies smart-fit to video elements after metadata establishes an extreme aspect ratio", () => {
    render(
      <VideoCardPlayer
        src="https://example.com/clip.mp4"
        alt="Clip"
        mode="ambient"
        fitStrategy="smart"
      />
    );

    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 600 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1800 });

    fireEvent(video, new Event("loadedmetadata"));

    expect(video).toHaveAttribute("data-media-fit", "smart");
    expect(video).toHaveClass("object-contain");
  });

  it("keeps the playback toggle accessible for reduced-motion users and starts paused", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    useVideoVisibilityMock.mockReturnValue({
      videoRef: { current: null },
      reducedMotion: true,
    });

    render(
      <VideoCardPlayer
        src="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        alt="Clip"
        mode="ambient"
        showPlaybackControl
      />
    );

    expect(screen.getByRole("button", { name: /play video/i })).toBeTruthy();
  });
});

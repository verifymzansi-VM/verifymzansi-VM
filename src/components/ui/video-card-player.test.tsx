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
});

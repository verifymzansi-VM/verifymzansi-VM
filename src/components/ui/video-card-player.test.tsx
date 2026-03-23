/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { useVideoVisibilityMock } = vi.hoisted(() => ({
  useVideoVisibilityMock: vi.fn(),
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

const { VideoCardPlayer } = await import("./video-card-player");

describe("VideoCardPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVideoVisibilityMock.mockReturnValue({
      videoRef: { current: null },
      reducedMotion: false,
    });
  });

  it("renders ambient video previews muted with no control buttons", () => {
    render(
      <VideoCardPlayer
        src="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        alt="Clip"
        mode="ambient"
      />
    );

    const video = document.querySelector("video");
    expect(video).toBeTruthy();
    expect((video as HTMLVideoElement).muted).toBe(true);
    expect(screen.queryByRole("button")).toBeNull();
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
      />
    );

    expect(screen.getByAltText("Clip")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders images with full-cover styling", () => {
    render(<VideoCardPlayer src="https://example.com/photo.jpg" alt="Photo" mode="ambient" />);

    expect(screen.getByAltText("Photo")).toHaveClass("object-cover");
  });
});

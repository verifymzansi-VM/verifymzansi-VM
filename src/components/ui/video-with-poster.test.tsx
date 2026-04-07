/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { VideoPlaybackProvider } from "@/contexts/video-playback-context";

const playMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(playMock);

function Wrapper({ children }: { children: React.ReactNode }) {
  return <VideoPlaybackProvider>{children}</VideoPlaybackProvider>;
}

describe("VideoWithPoster", () => {
  it("falls back when poster image fails to load", async () => {
    const { VideoWithPoster } = await import("@/components/ui/video-with-poster");

    render(
      <VideoWithPoster
        src="https://example.com/video.mp4"
        posterUrl="https://example.com/poster.jpg"
      />,
      { wrapper: Wrapper }
    );

    const poster = screen.getByAltText("Video thumbnail");
    fireEvent.error(poster);

    expect(screen.queryByAltText("Video thumbnail")).toBeNull();
    expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
  });

  it("shows retry overlay when video fails after activation", async () => {
    const { VideoWithPoster } = await import("@/components/ui/video-with-poster");

    render(
      <VideoWithPoster
        src="https://example.com/video.mp4"
        posterUrl="https://example.com/poster.jpg"
      />,
      { wrapper: Wrapper }
    );

    fireEvent.click(screen.getByRole("button", { name: "Play video" }));

    const video = screen.getByLabelText("Video player");
    fireEvent.error(video);

    expect(screen.getByText("Video failed to load")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry playing video" })).toBeTruthy();
  });
});

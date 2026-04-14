import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PosterCardShell } from "./poster-card-shell";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/video-card-player", () => ({
  isVideoUrl: (url?: string | null) => Boolean(url?.endsWith(".mp4")),
  VideoCardPlayer: ({ showPlaybackControl }: { showPlaybackControl?: boolean }) => (
    <div data-testid="video-player" data-controls={showPlaybackControl ? "yes" : "no"} />
  ),
}));

vi.mock("@/components/ui/video-duration-badge", () => ({
  VideoDurationBadge: () => <div data-testid="video-duration-badge" />,
}));

describe("PosterCardShell", () => {
  it("keeps hero playback controls outside of the card-level link", () => {
    const { container } = render(
      <PosterCardShell
        href="/listing/abc"
        title="Hero video"
        mediaUrl="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        showPlaybackControl
        cardVariant="hero"
      />
    );

    const outerLinks = container.querySelectorAll('a[href="/listing/abc"]');
    expect(outerLinks).toHaveLength(1);
    expect(outerLinks[0]).toContainElement(screen.getByText("Hero video"));
    expect(screen.getByTestId("video-player").closest("a")).toBeNull();
  });
});

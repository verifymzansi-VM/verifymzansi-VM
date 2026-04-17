import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PosterCardShell } from "./poster-card-shell";

const { videoCardPlayerMock } = vi.hoisted(() => ({
  videoCardPlayerMock: vi.fn(
    ({
      showPlaybackControl,
      deferVideoLoadUntilPlay,
      fitStrategy,
    }: {
      showPlaybackControl?: boolean;
      deferVideoLoadUntilPlay?: boolean;
      fitStrategy?: string;
    }) => (
      <div
        data-testid="video-player"
        data-controls={showPlaybackControl ? "yes" : "no"}
        data-defer={deferVideoLoadUntilPlay ? "yes" : "no"}
        data-fit={fitStrategy ?? ""}
      />
    )
  ),
}));

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
  VideoCardPlayer: videoCardPlayerMock,
}));

vi.mock("@/components/ui/video-duration-badge", () => ({
  VideoDurationBadge: () => <div data-testid="video-duration-badge" />,
}));

describe("PosterCardShell", () => {
  it("keeps hero playback controls outside of the full-card link overlay", () => {
    const { container } = render(
      <PosterCardShell
        href="/listing/abc"
        title="Hero video"
        mediaUrl="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        showPlaybackControl
        cardVariant="hero"
        makeEntireCardClickable
      />
    );

    expect(screen.getByRole("link", { name: "Open Hero video" })).toBeInTheDocument();
    const outerLinks = container.querySelectorAll('a[href="/listing/abc"]');
    expect(outerLinks).toHaveLength(1);
    expect(screen.getByTestId("video-player").closest("a")).toBeNull();
  });

  it("disables native drag on hero card links used by the showroom", () => {
    render(
      <PosterCardShell
        href="/listing/hero"
        title="Hero image"
        mediaUrl="https://example.com/poster.jpg"
        cardVariant="hero"
      />
    );

    expect(screen.getByRole("link", { name: /hero image/i })).toHaveAttribute("draggable", "false");
  });

  it("forwards deferred video loading to the media player when requested", () => {
    render(
      <PosterCardShell
        href="/listing/deferred"
        title="Deferred hero"
        mediaUrl="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        deferVideoLoadUntilPlay
      />
    );

    expect(screen.getByTestId("video-player")).toHaveAttribute("data-defer", "yes");
  });

  it("defaults card media to contain fit so uploads are fully visible", () => {
    render(
      <PosterCardShell
        href="/listing/contain"
        title="Contained card"
        mediaUrl="https://example.com/poster.jpg"
      />
    );

    expect(screen.getByTestId("video-player")).toHaveAttribute("data-fit", "contain");
  });

  it("uses a solid surface for hero showroom cards", () => {
    const { container } = render(
      <PosterCardShell
        href="/listing/solid"
        title="Solid hero"
        mediaUrl="https://example.com/poster.jpg"
        cardVariant="hero"
      />
    );

    const heroCard = container.querySelector('[data-card-variant="hero"]');
    expect(heroCard).toBeTruthy();
    expect(heroCard?.className).toContain("bg-white");
    expect(heroCard?.className).not.toContain("bg-white/95");
    expect(heroCard?.className).not.toContain("backdrop-blur");
  });

  it("renders engagement counts and a like button when engagement data is provided", () => {
    const { container } = render(
      <PosterCardShell
        href="/listing/engaged"
        title="Engaged card"
        mediaUrl="https://example.com/poster.jpg"
        viewCount={128}
        likeCount={1200}
        viewerHasLiked
        engagementTargetId="listing-123"
        engagementTargetType="listing"
      />
    );

    expect(screen.queryByText(/views/i)).not.toBeInTheDocument();
    const likeButton = screen.getByRole("button", { name: /unlike this card/i });
    expect(likeButton).toBeInTheDocument();
    expect(likeButton).toHaveTextContent("999");
    expect(container.querySelector(".bottom-3.right-3")).toBeTruthy();
  });
});

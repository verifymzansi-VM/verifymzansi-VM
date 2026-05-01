import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PosterCardShell } from "./poster-card-shell";

const { videoCardPlayerMock } = vi.hoisted(() => ({
  videoCardPlayerMock: vi.fn(
    ({
      showPlaybackControl,
      deferVideoLoadUntilPlay,
      fitStrategy,
      disableNativeDrag,
      onPlaybackStateChange,
      fallback,
    }: {
      showPlaybackControl?: boolean;
      deferVideoLoadUntilPlay?: boolean;
      fitStrategy?: string;
      disableNativeDrag?: boolean;
      onPlaybackStateChange?: (isPlaying: boolean) => void;
      fallback?: React.ReactNode;
    }) => (
      <div
        data-testid="video-player"
        data-controls={showPlaybackControl ? "yes" : "no"}
        data-defer={deferVideoLoadUntilPlay ? "yes" : "no"}
        data-fit={fitStrategy ?? ""}
        data-drag-disabled={disableNativeDrag ? "yes" : "no"}
      >
        <button type="button" onClick={() => onPlaybackStateChange?.(true)}>
          mock play
        </button>
        <button type="button" onClick={() => onPlaybackStateChange?.(false)}>
          mock pause
        </button>
        {fallback}
      </div>
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

  it("hides the title and logo row while a controlled hero video is playing", () => {
    render(
      <PosterCardShell
        href="/listing/video"
        title="Video title"
        mediaUrl="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        logoUrl="https://example.com/logo.jpg"
        showPlaybackControl
        cardVariant="hero"
        makeEntireCardClickable
      />
    );

    const title = screen.getByRole("heading", { name: "Video title" });
    const metadataRow = title.parentElement?.parentElement;

    expect(metadataRow).not.toHaveClass("opacity-0");

    fireEvent.click(screen.getByRole("button", { name: "mock play" }));
    expect(metadataRow).toHaveClass("opacity-0");
    expect(metadataRow).toHaveClass("pointer-events-none");

    fireEvent.click(screen.getByRole("button", { name: "mock pause" }));
    expect(metadataRow).not.toHaveClass("opacity-0");
  });

  it("hides the title and logo row for standard tourism video cards while playing", () => {
    render(
      <PosterCardShell
        href="/listing/video"
        title="Standard video"
        mediaUrl="https://example.com/clip.mp4"
        posterUrl="https://example.com/poster.jpg"
        logoUrl="https://example.com/logo.jpg"
      />
    );

    const title = screen.getByRole("heading", { name: "Standard video" });
    const metadataRow = title.parentElement?.parentElement;

    fireEvent.click(screen.getByRole("button", { name: "mock play" }));
    expect(metadataRow).toHaveClass("opacity-0");
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

  it("can disable native drag on non-hero cards used by homepage rails", () => {
    render(
      <PosterCardShell
        href="/listing/rail"
        title="Rail image"
        mediaUrl="https://example.com/poster.jpg"
        disableNativeDrag
      />
    );

    expect(screen.getByRole("link", { name: /rail image/i })).toHaveAttribute("draggable", "false");
    expect(screen.getByTestId("video-player")).toHaveAttribute("data-drag-disabled", "yes");
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

  it("renders poster cards without a like button overlay", () => {
    render(
      <PosterCardShell
        href="/listing/plain"
        title="Plain card"
        mediaUrl="https://example.com/poster.jpg"
        viewCount={128}
      />
    );

    expect(screen.getByRole("link", { name: /plain card/i })).toHaveAttribute(
      "href",
      "/listing/plain"
    );
    expect(screen.queryByRole("button", { name: /like this card|unlike this card/i })).toBeNull();
  });

  it("renders branded fallback artwork for failed media when provided", () => {
    render(
      <PosterCardShell
        href="/listing/fallback"
        title="Fallback listing"
        mediaUrl="https://example.com/missing.jpg"
        mediaFallbackUrl="/images/fallbacks/hero-listing.svg"
      />
    );

    expect(screen.getByText("Public preview")).toBeInTheDocument();
    expect(screen.getAllByText("Fallback listing")).toHaveLength(2);
  });
});

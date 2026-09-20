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
      fallback,
    }: {
      showPlaybackControl?: boolean;
      deferVideoLoadUntilPlay?: boolean;
      fitStrategy?: string;
      disableNativeDrag?: boolean;
      fallback?: React.ReactNode;
    }) => (
      <div
        data-testid="video-player"
        data-controls={showPlaybackControl ? "yes" : "no"}
        data-defer={deferVideoLoadUntilPlay ? "yes" : "no"}
        data-fit={fitStrategy ?? ""}
        data-drag-disabled={disableNativeDrag ? "yes" : "no"}
      >
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
  it.each(["hero", "showcase"] as const)("records %s card video playback", (cardVariant) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ recorded: true }),
    } as Response);
    videoCardPlayerMock.mockImplementationOnce(() => <video src="/clip.mp4" />);
    try {
      const id = crypto.randomUUID();
      const { container, unmount } = render(
        <PosterCardShell
          href={`/listing/${id}`}
          title="Video"
          mediaUrl="/clip.mp4"
          cardVariant={cardVariant}
        />
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      const video = container.querySelector("video")!;
      let now = Date.now();
      const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
      Object.defineProperty(video, "paused", { configurable: true, value: false });
      Object.defineProperty(video, "duration", { configurable: true, value: 10 });
      fireEvent.playing(video);
      expect(fetchSpy).not.toHaveBeenCalled();
      for (let i = 1; i <= 9; i++) {
        now += 1000;
        video.currentTime = i;
        fireEvent.timeUpdate(video);
      }
      clock.mockRestore();
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/engagement/view",
        expect.objectContaining({
          body: expect.stringContaining(`"targetId":"${id}"`),
        })
      );
      unmount();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("fills homepage cards with media and fades details only during playback", () => {
    const { container } = render(
      <PosterCardShell
        href="/listing/mobile"
        title="Mobile video"
        mediaUrl="/clip.mp4"
        eyebrow="R 123 000"
        location="Durban"
        logoUrl="/logo.png"
        cardVariant="showcase"
        immersive
      />
    );
    const player = screen.getByTestId("video-player");
    const overlay = container.querySelector("[data-card-overlay]");
    expect(container.querySelector("[data-card-metadata]")).toBeNull();
    expect(player).toHaveAttribute("data-fit", "cover");
    expect(screen.getByRole("link", { name: "Open Mobile video" })).toHaveAttribute(
      "href",
      "/listing/mobile"
    );
    expect(overlay).toHaveClass("opacity-100");
    expect(overlay).toContainElement(screen.getByText("Durban"));
    expect(overlay).toContainElement(screen.getByAltText("Mobile video logo"));
    fireEvent.playing(player);
    expect(overlay).toHaveClass("opacity-0");
    fireEvent.pause(player);
    expect(overlay).toHaveClass("opacity-100");
    fireEvent.playing(player);
    fireEvent.ended(player);
    expect(overlay).toHaveClass("opacity-100");
  });

  it("keeps feed video controls outside navigation links", () => {
    render(<PosterCardShell href="/listing/feed" title="Feed video" mediaUrl="/clip.mp4" />);
    expect(screen.getByTestId("video-player").closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: /Feed video/ })).toHaveAttribute(
      "href",
      "/listing/feed"
    );
  });

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

  it("keeps non-showroom showcase cards free of a metadata surface", () => {
    const { container } = render(
      <PosterCardShell
        href="/listing/showcase"
        title="Showcase listing"
        mediaUrl="https://example.com/poster.jpg"
        cardVariant="showcase"
      />
    );

    const showcaseCard = container.querySelector('[data-card-variant="showcase"]');
    expect(showcaseCard?.className).toContain("bg-transparent");
    expect(showcaseCard?.className).not.toContain("bg-white/96");
    expect(showcaseCard?.className).not.toContain("backdrop-blur");
    expect(showcaseCard?.querySelector("[data-card-media]")?.className).toContain("rounded-xl");
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

import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShowroomHero } from "./showroom-hero";

const { videoCardPlayerMock } = vi.hoisted(() => ({
  videoCardPlayerMock: vi.fn(
    ({
      alt,
      muteControlVisibility,
      showPlaybackControl,
      onPlaybackStateChange,
    }: {
      alt?: string;
      muteControlVisibility?: string;
      showPlaybackControl?: boolean;
      onPlaybackStateChange?: (isPlaying: boolean) => void;
    }) => (
      <div
        data-testid="showroom-media"
        data-mute-control={muteControlVisibility}
        data-playback-control={showPlaybackControl ? "true" : "false"}
      >
        <span>{alt}</span>
        {showPlaybackControl ? (
          <>
            <button type="button" onClick={() => onPlaybackStateChange?.(false)}>
              Pause media
            </button>
            <button type="button" onClick={() => onPlaybackStateChange?.(true)}>
              Play media
            </button>
          </>
        ) : null}
      </div>
    )
  ),
}));

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    fill: _fill,
    sizes: _sizes,
    priority: _priority,
    unoptimized: _unoptimized,
    ...props
  }: Record<string, unknown> & { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: videoCardPlayerMock,
  isVideoUrl: (url: string | null | undefined) =>
    url?.split("?")[0].toLowerCase().endsWith(".mp4") ?? false,
}));

describe("ShowroomHero", () => {
  it("uses /listing/:id for listing CTA links", async () => {
    render(
      <ShowroomHero
        slides={[
          {
            id: "listing-1",
            type: "listing",
            title: "Verified Phone",
            description: "Great condition",
            location: "Cape Town",
            mediaUrl: "https://example.com/photo.jpg",
          },
        ]}
      />
    );

    await waitFor(() => {
      const ctas = screen.getAllByRole("link", { name: /view listing/i });
      expect(ctas.some((link) => link.getAttribute("href") === "/listing/listing-1")).toBe(true);
    });
  });

  it("routes storefront type to /mzansi-business/", async () => {
    render(
      <ShowroomHero
        slides={[
          {
            id: "store-1",
            type: "storefront",
            title: "Mall Store",
            description: "New arrivals",
            location: "Sandton",
            mediaUrl: "https://example.com/store.jpg",
          },
        ]}
      />
    );

    await waitFor(() => {
      const ctas = screen.getAllByRole("link", { name: /visit shop/i });
      expect(ctas.some((link) => link.getAttribute("href") === "/mzansi-business/store-1")).toBe(
        true
      );
    });
  });

  it("prefers slide CTA overrides when provided", async () => {
    render(
      <ShowroomHero
        slides={[
          {
            id: "business-empty",
            type: "business",
            title: "Mzansi Business",
            description: "Discover verified South African businesses and services.",
            location: "South Africa",
            mediaUrl: "/images/fallbacks/hero-shop.svg",
            hrefOverride: "/post/create-business",
            ctaLabelOverride: "List Your Business",
            badgeLabelOverride: "Mzansi Business",
          },
        ]}
      />
    );

    await waitFor(() => {
      const ctas = screen.getAllByRole("link", { name: /list your business/i });
      expect(ctas.some((link) => link.getAttribute("href") === "/post/create-business")).toBe(true);
    });

    expect(screen.getAllByText("Mzansi Business").length).toBeGreaterThan(0);
  });

  it("renders placeholder content when slides are empty", async () => {
    render(<ShowroomHero slides={[]} />);

    await waitFor(() => {
      expect(screen.getAllByText("Welcome to VerifyMzansi Showroom").length).toBeGreaterThan(0);
    });
  });

  it("keeps the mute control visible on showroom media", () => {
    render(
      <ShowroomHero
        slides={[
          {
            id: "listing-1",
            type: "listing",
            title: "Verified Phone",
            description: "Great condition",
            location: "Cape Town",
            mediaUrl: "https://example.com/video.mp4",
            posterUrl: "https://example.com/poster.jpg",
          },
        ]}
      />
    );

    expect(screen.getByTestId("showroom-media")).toHaveAttribute("data-mute-control", "always");
  });

  it("shows playback controls only for video slides", () => {
    const { rerender } = render(
      <ShowroomHero
        slides={[
          {
            id: "listing-1",
            type: "listing",
            title: "Verified Phone",
            description: "Great condition",
            location: "Cape Town",
            mediaUrl: "https://example.com/video.mp4",
          },
        ]}
      />
    );

    expect(screen.getByTestId("showroom-media")).toHaveAttribute("data-playback-control", "true");

    rerender(
      <ShowroomHero
        slides={[
          {
            id: "listing-2",
            type: "listing",
            title: "Verified Camera",
            description: "Clean condition",
            location: "Durban",
            mediaUrl: "https://example.com/photo.jpg",
          },
        ]}
      />
    );

    expect(screen.getByTestId("showroom-media")).toHaveAttribute("data-playback-control", "false");
  });

  it("uses shared slide indicators without desktop arrow buttons", async () => {
    render(
      <ShowroomHero
        slides={[
          {
            id: "listing-1",
            type: "listing",
            title: "Verified Phone",
            description: "Great condition",
            location: "Cape Town",
            mediaUrl: "https://example.com/photo-1.jpg",
          },
          {
            id: "listing-2",
            type: "listing",
            title: "Verified Laptop",
            description: "Lightly used",
            location: "Durban",
            mediaUrl: "https://example.com/photo-2.jpg",
          },
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /go to slide 1/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /go to slide 2/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /previous slide/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next slide/i })).not.toBeInTheDocument();
  });

  it("pauses auto-advance while the active video is manually paused and resumes when played", async () => {
    vi.useFakeTimers();

    render(
      <ShowroomHero
        slides={[
          {
            id: "listing-1",
            type: "listing",
            title: "Verified Phone",
            description: "Great condition",
            location: "Cape Town",
            mediaUrl: "https://example.com/phone.mp4",
          },
          {
            id: "listing-2",
            type: "listing",
            title: "Verified Laptop",
            description: "Lightly used",
            location: "Durban",
            mediaUrl: "https://example.com/laptop.mp4",
          },
        ]}
      />
    );

    expect(screen.getByRole("heading", { name: "Verified Phone" })).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: /pause media/i }).click();
    });

    await act(async () => {
      vi.advanceTimersByTime(9000);
    });

    expect(screen.getByRole("heading", { name: "Verified Phone" })).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: /play media/i }).click();
    });

    await act(async () => {
      vi.advanceTimersByTime(8240);
    });

    expect(screen.getByRole("heading", { name: "Verified Laptop" })).toBeInTheDocument();
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it("resets the paused state when the slide changes", async () => {
    vi.useFakeTimers();

    render(
      <ShowroomHero
        slides={[
          {
            id: "listing-1",
            type: "listing",
            title: "Verified Phone",
            description: "Great condition",
            location: "Cape Town",
            mediaUrl: "https://example.com/phone.mp4",
          },
          {
            id: "listing-2",
            type: "listing",
            title: "Verified Laptop",
            description: "Lightly used",
            location: "Durban",
            mediaUrl: "https://example.com/laptop.mp4",
          },
        ]}
      />
    );

    await act(async () => {
      screen.getByRole("button", { name: /pause media/i }).click();
      screen.getByRole("button", { name: /go to slide 2/i }).click();
      vi.advanceTimersByTime(240);
    });

    expect(screen.getByRole("heading", { name: "Verified Laptop" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(8240);
    });

    expect(screen.getByRole("heading", { name: "Verified Phone" })).toBeInTheDocument();
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });
});

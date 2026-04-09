/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeroBanner } from "./hero-banner";

const { videoCardPlayerMock } = vi.hoisted(() => ({
  videoCardPlayerMock: vi.fn(
    ({
      alt,
      muteControlVisibility,
      showPlaybackControl,
      deferVideoLoadUntilPlay,
    }: {
      alt?: string;
      muteControlVisibility?: string;
      showPlaybackControl?: boolean;
      deferVideoLoadUntilPlay?: boolean;
    }) => (
      <div
        data-testid="hero-media"
        data-mute-control={muteControlVisibility}
        data-playback-control={showPlaybackControl ? "true" : "false"}
        data-defer-video-load={deferVideoLoadUntilPlay ? "true" : "false"}
      >
        <span>{alt}</span>
      </div>
    )
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
  useVideoVisibility: () => ({ videoRef: { current: null }, reducedMotion: false }),
}));

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: videoCardPlayerMock,
  isVideoUrl: (url: string | null | undefined) =>
    url?.split("?")[0].toLowerCase().endsWith(".mp4") ?? false,
}));

vi.mock("./promo-video-slide", () => ({
  PromoVideoSlide: () => <div data-testid="promo-video-slide" />,
}));

describe("HeroBanner", () => {
  it("does not render the legacy category strip or search controls", () => {
    render(
      <HeroBanner
        latestListings={[
          {
            id: "listing-1",
            title: "Honda Fit",
            description: "Clean hatchback",
            location_city: "Johannesburg",
            photos: ["/images/fallbacks/hero-listing.svg"],
          },
        ]}
      />
    );

    expect(
      screen.queryByRole("navigation", { name: "Marketplace categories" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search area")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search listings")).not.toBeInTheDocument();
  });

  it("uses shared slide indicators without desktop arrow buttons", () => {
    render(
      <HeroBanner
        latestListings={[
          {
            id: "listing-1",
            title: "Honda Fit",
            description: "Clean hatchback",
            location_city: "Johannesburg",
            photos: ["/images/fallbacks/hero-listing.svg"],
          },
          {
            id: "listing-2",
            title: "Toyota Starlet",
            description: "Fuel saver",
            location_city: "Durban",
            photos: ["/images/fallbacks/hero-listing.svg"],
          },
        ]}
      />
    );

    expect(screen.getByRole("button", { name: /go to slide 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /go to slide 2/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /previous slide/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next slide/i })).not.toBeInTheDocument();
  });

  it("keeps the mute control visible and shows playback control for video slides", () => {
    render(
      <HeroBanner
        latestListings={[
          {
            id: "listing-1",
            title: "Honda Fit",
            description: "Clean hatchback",
            location_city: "Johannesburg",
            videos: ["https://example.com/honda-fit.mp4"],
            video_thumbnail: "/images/fallbacks/hero-listing.svg",
          },
        ]}
      />
    );

    expect(screen.getByTestId("hero-media")).toHaveAttribute("data-mute-control", "always");
    expect(screen.getByTestId("hero-media")).toHaveAttribute("data-playback-control", "true");
    expect(screen.getByTestId("hero-media")).toHaveAttribute("data-defer-video-load", "false");
  });
});

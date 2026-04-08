/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { ListingCardList } from "./listing-card-list";

const { videoCardPlayerMock } = vi.hoisted(() => ({
  videoCardPlayerMock: vi.fn(
    ({ src, posterUrl, mode }: { src: string; posterUrl?: string; mode?: string }) => (
      <div
        data-testid="video-card-player"
        data-src={src}
        data-poster={posterUrl ?? ""}
        data-mode={mode ?? ""}
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

vi.mock("next/image", () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({
    children,
    trustLevel: _trustLevel,
    ...props
  }: {
    children: React.ReactNode;
    trustLevel?: unknown;
    [key: string]: unknown;
  }) => (
    <div data-testid="card" {...props}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: videoCardPlayerMock,
  isVideoUrl: (url: string | undefined) => Boolean(url?.endsWith(".mp4")),
}));

vi.mock("@/lib/utils/format", () => ({
  formatZARShort: () => "R150",
}));

describe("ListingCardList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses ambient mode for list card videos", () => {
    render(
      <ListingCardList
        id="listing-1"
        title="Test Listing"
        price={15000}
        imageUrl="https://example.com/listing.mp4"
        posterUrl="https://example.com/listing.jpg"
        province="Gauteng"
        city="Johannesburg"
        category="Electronics"
        createdAt={new Date().toISOString()}
      />
    );

    const player = screen.getByTestId("video-card-player");
    expect(player).toHaveAttribute("data-src", "https://example.com/listing.mp4");
    expect(player).toHaveAttribute("data-poster", "https://example.com/listing.jpg");
    expect(player).toHaveAttribute("data-mode", "ambient");
  });
});

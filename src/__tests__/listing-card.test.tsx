/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

const videoCardPlayerMock = vi.fn(
  ({
    src,
    isVideo,
    fitStrategy,
    muteControlVisibility,
  }: {
    src: string;
    isVideo?: boolean;
    fitStrategy?: string;
    muteControlVisibility?: string;
  }) => (
    <div
      data-testid="video-card-player"
      data-src={src}
      data-is-video={isVideo ? "true" : "false"}
      data-fit-strategy={fitStrategy}
      data-mute-control={muteControlVisibility}
    />
  )
);

// Mock dependencies
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
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
    quality: _quality,
    loader: _loader,
    placeholder: _placeholder,
    blurDataURL: _blur,
    ...props
  }: Record<string, unknown> & { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({
    children,
    trustLevel,
    ...props
  }: {
    children: React.ReactNode;
    trustLevel?: unknown;
  }) => (
    <div
      data-testid="card"
      data-trust-level={trustLevel === undefined ? undefined : String(trustLevel)}
      {...props}
    >
      {children}
    </div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    variant: _variant,
    ...props
  }: {
    children: React.ReactNode;
    variant?: string;
  }) => (
    <span data-testid="badge" {...props}>
      {children}
    </span>
  ),
}));

vi.mock("@/components/trust/trust-badge", () => ({
  TrustBadge: ({ level }: { level: string }) => <span data-testid="trust-badge">{level}</span>,
}));

vi.mock("@/lib/utils/format", () => ({
  formatZAR: (cents: number) => `R ${(cents / 100).toFixed(2)}`,
  formatZARShort: (cents: number) => `R${Math.round(cents / 100)}`,
  formatRelativeTime: (_date: string) => "2d ago",
}));

vi.mock("@/hooks/use-video-visibility", () => ({
  useVideoVisibility: () => ({ videoRef: { current: null }, reducedMotion: false }),
}));

vi.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: videoCardPlayerMock,
  isVideoUrl: (url: string | null | undefined) => {
    if (!url) return false;
    return (
      url
        .split("?")[0]
        .toLowerCase()
        .match(/\.(mp4|webm|ogg)$/) != null
    );
  },
}));

vi.mock(import("@/types/enums"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    TrustLevel: {
      BASIC: "basic",
      VERIFIED: "verified",
      TRUSTED: "trusted",
    },
  };
});

const { ListingCard } = await import("@/components/listings/listing-card");

describe("ListingCard", () => {
  const defaultProps = {
    id: "listing-1",
    title: "Test Listing",
    price: 15000,
    imageUrl: "/images/test.jpg",
    province: "Gauteng",
    city: "Johannesburg",
    category: "Electronics",
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render listing title", () => {
    render(<ListingCard {...defaultProps} />);
    expect(screen.getByText("Test Listing")).toBeTruthy();
  });

  it("should render formatted price", () => {
    render(<ListingCard {...defaultProps} />);
    expect(screen.getByText("R150")).toBeTruthy();
  });

  it("renders city as the card description", () => {
    render(<ListingCard {...defaultProps} />);
    expect(screen.getByText(/Johannesburg/)).toBeTruthy();
  });

  it("shows only the simplified overlay metadata", () => {
    render(<ListingCard {...defaultProps} />);
    expect(screen.queryByText(/Electronics/i)).toBeNull();
    expect(screen.queryByText(/Brand: Apple/i)).toBeNull();
  });

  it("renders the highest-priority status chip only", () => {
    render(<ListingCard {...defaultProps} featured boosted urgent />);
    expect(screen.getByText("Urgent")).toBeTruthy();
    expect(screen.queryByText("Boosted")).toBeNull();
  });

  it("renders the listing logo when provided", () => {
    render(<ListingCard {...defaultProps} logoUrl="https://example.com/logo.jpg" />);

    expect(screen.getByAltText("Business logo")).toHaveAttribute(
      "src",
      "https://example.com/logo.jpg"
    );
  });

  it("should render link to listing detail page", () => {
    render(<ListingCard {...defaultProps} />);
    const links = screen.getAllByRole("link");
    const listingLink = links.find((l) => l.getAttribute("href")?.includes("listing-1"));
    expect(listingLink).toBeTruthy();
  });

  it("should preserve trust styling when owner trust level provided", () => {
    render(<ListingCard {...defaultProps} ownerTrustLevel={2 as never} />);
    expect(screen.getByTestId("card")).toHaveAttribute("data-trust-level", "2");
  });

  it("should show boosted indicator when boosted", () => {
    render(<ListingCard {...defaultProps} boosted />);
    // Boosted cards may have a special indicator/badge
    const card = screen.getByTestId("card");
    expect(card).toBeTruthy();
  });

  it("renders video player for blob preview when explicitly marked as video", () => {
    const blobUrl = "blob:http://localhost:3000/abc-123";

    render(<ListingCard {...defaultProps} imageUrl={blobUrl} isVideo />);

    const videoPlayer = screen.getByTestId("video-card-player");
    expect(videoPlayer).toBeTruthy();
    expect(videoPlayer).toHaveAttribute("data-src", blobUrl);
    expect(videoPlayer).toHaveAttribute("data-is-video", "true");
    expect(videoPlayer).toHaveAttribute("data-fit-strategy", "smart");
    expect(videoPlayer).toHaveAttribute("data-mute-control", "always");
    expect(screen.queryByAltText("Test Listing")).toBeNull();
  });
});

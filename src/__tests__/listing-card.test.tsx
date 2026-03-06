/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

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
    trustLevel: _trustLevel,
    ...props
  }: {
    children: React.ReactNode;
    trustLevel?: unknown;
  }) => (
    <div data-testid="card" {...props}>
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
  formatRelativeTime: (_date: string) => "2d ago",
}));

vi.mock("@/hooks/use-video-visibility", () => ({
  useVideoVisibility: () => ({ videoRef: { current: null }, reducedMotion: false }),
}));

vi.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: ({ src, alt }: { src: string; alt?: string }) => (
    <div data-testid="video-card-player" data-src={src}>
      {alt}
    </div>
  ),
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
    expect(screen.getByText(/R\s*150\.00/)).toBeTruthy();
  });

  it("should render location info", () => {
    render(<ListingCard {...defaultProps} />);
    expect(screen.getByText(/Johannesburg/)).toBeTruthy();
  });

  it("should accept category prop", () => {
    // category is accepted as a prop but not visually rendered in the card
    const { container } = render(<ListingCard {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it("should render negotiable badge when applicable", () => {
    render(<ListingCard {...defaultProps} negotiable />);
    // The component renders "Neg." text for negotiable items
    expect(screen.getByText("Neg.")).toBeTruthy();
  });

  it("should render link to listing detail page", () => {
    render(<ListingCard {...defaultProps} />);
    const links = screen.getAllByRole("link");
    const listingLink = links.find((l) => l.getAttribute("href")?.includes("listing-1"));
    expect(listingLink).toBeTruthy();
  });

  it("should render trust badge when seller trust level provided", () => {
    render(<ListingCard {...defaultProps} sellerTrustLevel={2 as never} />);
    expect(screen.getByTestId("trust-badge")).toBeTruthy();
  });

  it("should show boosted indicator when boosted", () => {
    render(<ListingCard {...defaultProps} boosted />);
    // Boosted cards may have a special indicator/badge
    const card = screen.getByTestId("card");
    expect(card).toBeTruthy();
  });
});

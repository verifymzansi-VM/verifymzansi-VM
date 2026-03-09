/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

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
    ...props
  }: Record<string, unknown> & { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, trustLevel: _trustLevel, ...props }: { children: React.ReactNode }) => (
    <div data-testid="card" {...props}>
      {children}
    </div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: { children: React.ReactNode }) => (
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
  formatRelativeTime: () => "1d ago",
}));

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: ({ src }: { src: string }) => <div data-testid="video-card-player">{src}</div>,
  isVideoUrl: (url: string | null | undefined) => Boolean(url?.endsWith(".mp4")),
}));

const { PromotionCard } = await import("@/components/listings/promotion-card");

describe("PromotionCard", () => {
  const defaultProps = {
    id: "promotion-1",
    title: "Night Market",
    price: 5000,
    imageUrl: "/images/event.jpg",
    province: "Gauteng",
    city: "Johannesburg",
    promotionType: "event" as const,
    createdAt: "2026-03-08T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders event timing and state for event promotions", () => {
    render(
      <PromotionCard
        {...defaultProps}
        startDate="2099-03-10T00:00:00.000Z"
        endDate="2099-03-12T00:00:00.000Z"
      />
    );

    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.getByText(/Ends/i)).toBeTruthy();
  });

  it("renders linked business context when provided", () => {
    render(<PromotionCard {...defaultProps} businessName="Nomsa Foods" />);

    expect(screen.getByText(/by Nomsa Foods/i)).toBeTruthy();
  });

  it("renders category label for non-event promotions", () => {
    render(
      <PromotionCard
        {...defaultProps}
        promotionType="deal"
        categoryLabel="Food & Dining"
        endDate="2099-03-12T00:00:00.000Z"
      />
    );

    expect(screen.getByText(/Food & Dining/i)).toBeTruthy();
    expect(screen.getByText(/Ends/i)).toBeTruthy();
  });
});

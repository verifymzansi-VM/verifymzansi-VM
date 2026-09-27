/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

const videoCardPlayerMock = vi.fn(
  ({
    src,
    mode,
    fitStrategy,
    muteControlVisibility,
  }: {
    src: string;
    mode?: string;
    fitStrategy?: string;
    muteControlVisibility?: string;
  }) => (
    <div
      data-testid="video-card-player"
      data-src={src}
      data-mode={mode}
      data-fit-strategy={fitStrategy}
      data-mute-control={muteControlVisibility}
    />
  )
);

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

vi.mock("@/lib/utils/format", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  formatZAR: (cents: number) => `R ${(cents / 100).toFixed(2)}`,
  formatZARShort: (cents: number) => `R${Math.round(cents / 100)}`,
  formatRelativeTime: () => "1d ago",
  timeAgo: (_date: string) => "2h ago",
}));

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: videoCardPlayerMock,
  isVideoUrl: (url: string | null | undefined) => Boolean(url?.endsWith(".mp4")),
}));

vi.mock("@/components/ui/countdown-badge", () => ({
  CountdownBadge: ({ endDate }: { endDate: string }) => (
    <span data-testid="countdown-badge">Ends {endDate}</span>
  ),
}));

const { PromotionCard, getUrgencyLabel } = await import("@/components/listings/promotion-card");

describe("getUrgencyLabel", () => {
  // 10:00 SAST on Tuesday 10 March 2026.
  const now = new Date("2026-03-10T08:00:00Z");

  it("says 'Ends today!' for an event ending later the same SA day", () => {
    expect(getUrgencyLabel("2026-03-10T20:00:00Z", now)).toBe("Ends today!");
  });

  it("says 'Ends tomorrow!' for an event ending on the next SA day", () => {
    expect(getUrgencyLabel("2026-03-11T06:00:00Z", now)).toBe("Ends tomorrow!");
  });

  it("counts a few days left and stays quiet further out or after the end", () => {
    expect(getUrgencyLabel("2026-03-13T08:00:00Z", now)).toBe("3 days left");
    expect(getUrgencyLabel("2026-03-20T08:00:00Z", now)).toBeNull();
    expect(getUrgencyLabel("2026-03-10T07:00:00Z", now)).toBeNull();
    expect(getUrgencyLabel(null, now)).toBeNull();
  });
});

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

  it("renders the event date when there is no price", () => {
    render(
      <PromotionCard
        {...defaultProps}
        price={null}
        startDate="2099-03-10T00:00:00.000Z"
        endDate="2099-03-12T00:00:00.000Z"
      />
    );

    expect(screen.getByText("TUE 10 MAR")).toBeTruthy();
    expect(screen.queryByText("Event")).toBeNull();
    expect(screen.getByTestId("card")).toHaveClass("hover:border-teal-600/60");
  });

  it("hides linked business context in the reduced card", () => {
    render(<PromotionCard {...defaultProps} businessName="Nomsa Foods" />);

    expect(screen.queryByText(/by Nomsa Foods/i)).toBeNull();
  });

  it("hides status chips and category text on immersive cards", () => {
    render(
      <PromotionCard
        {...defaultProps}
        promotionType="event"
        categoryLabel="Food & Dining"
        endDate="2099-03-12T00:00:00.000Z"
        featured
      />
    );

    expect(screen.queryByText("Featured")).toBeNull();
    expect(screen.queryByText(/Food & Dining/i)).toBeNull();
    expect(screen.getByTestId("card")).toHaveClass("hover:border-teal-600/60");
  });

  it("preserves event card styling without a status badge", () => {
    render(<PromotionCard {...defaultProps} promotionType="event" />);

    expect(screen.queryByText("Event")).toBeNull();
    expect(screen.getByTestId("card")).toHaveClass("hover:border-teal-600/60");
  });

  it("keeps the type ribbon visible when the card is boosted", () => {
    render(<PromotionCard {...defaultProps} promotionType="event" boosted immersive={false} />);

    expect(screen.getByText("Event ★")).toBeTruthy();
    expect(screen.getByText("Event ★")).toHaveClass("bg-teal-800");
  });

  it("renders the linked business logo when provided", () => {
    render(<PromotionCard {...defaultProps} logoUrl="https://example.com/logo.jpg" />);

    expect(screen.getByAltText("Night Market logo")).toHaveAttribute(
      "src",
      "https://example.com/logo.jpg"
    );
  });

  it("uses the shared smart-fit video player for motion promotions", () => {
    render(
      <PromotionCard
        {...defaultProps}
        imageUrl="https://example.com/promo.mp4"
        posterUrl="https://example.com/promo.jpg"
      />
    );

    const videoPlayer = screen.getByTestId("video-card-player");
    expect(videoPlayer).toHaveAttribute("data-src", "https://example.com/promo.mp4");
    expect(videoPlayer).toHaveAttribute("data-mode", "hover");
    expect(videoPlayer).toHaveAttribute("data-fit-strategy", "smart");
    expect(videoPlayer).toHaveAttribute("data-mute-control", "always");
  });

  it("treats blob media as video when explicitly marked", () => {
    render(
      <PromotionCard
        {...defaultProps}
        imageUrl="blob:tourism-preview"
        posterUrl="blob:tourism-poster"
        isVideo
      />
    );

    const videoPlayer = screen.getByTestId("video-card-player");
    expect(videoPlayer).toHaveAttribute("data-src", "blob:tourism-preview");
    expect(videoPlayer).toHaveAttribute("data-mute-control", "always");
  });
});

/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { trackContentViewSpy } = vi.hoisted(() => ({
  trackContentViewSpy: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
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
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild,
    className,
    ...props
  }: {
    children: React.ReactNode;
    asChild?: boolean;
    className?: string;
  }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button className={className} {...props}>
        {children}
      </button>
    ),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/listings/promotion-contact-actions", () => ({
  PromotionContactActions: () => <div data-testid="promotion-contact-actions" />,
}));

vi.mock("@/components/trust/trust-badge", () => ({
  TrustBadge: () => <span>Trust Badge</span>,
}));

vi.mock("@/components/ui/media-lightbox", () => ({
  MediaLightbox: () => null,
}));

vi.mock("@/components/ui/profile-video-player", () => ({
  ProfileVideoPlayer: React.forwardRef<HTMLVideoElement, { title: string }>(function MockVideo(
    { title },
    ref
  ) {
    return <video ref={ref} aria-label={title} />;
  }),
}));

vi.mock("@/contexts/video-playback-context", () => ({
  useVideoPlaybackManager: () => ({
    register: vi.fn(),
    unregister: vi.fn(),
    updateVisibility: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-horizontal-swipe-navigation", () => ({
  useHorizontalSwipeNavigation: () => ({}),
}));

vi.mock("@/hooks/use-track-content-view", () => ({
  useTrackContentView: trackContentViewSpy,
}));

vi.mock("@/lib/constants/trust-scale", () => ({
  computeTrustLevel: () => 0,
}));

vi.mock("@/lib/account/compat", () => ({
  readAccountVerificationStatus: () => null,
}));

vi.mock("@/lib/utils/format", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  formatZAR: (value: number) => `R ${value}`,
}));

const { PromotionDetailContent } = await import("@/components/listings/promotion-detail-content");

describe("PromotionDetailContent", () => {
  it("renders review mode with preview copy and calendar link", () => {
    const futureStart = "2099-03-10T00:00:00.000Z";
    const futureEnd = "2099-03-12T00:00:00.000Z";
    const { container } = render(
      <PromotionDetailContent
        promotion={{
          id: "promotion-1",
          owner_id: "owner-1",
          business_id: "business-1",
          title: "Soweto Food Festival",
          description: "A long-form preview description for review mode.",
          promotion_type: "event",
          category: "Festival",
          category_key: "events_entertainment",
          photos: ["https://example.com/photo.jpg"],
          videos: [],
          video_thumbnail: null,
          price_cents: 15000,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          location_town: "Soweto",
          location_address: null,
          contact_methods: ["call", "whatsapp"],
          start_date: futureStart,
          end_date: futureEnd,
          boost_until: null,
          featured_until: null,
          view_count: 0,
          created_at: futureStart,
          event_details: {
            event_type: "festival_concert",
            venue_name: "Vilakazi Street",
            ticket_tiers: [{ name: "General", price_cents: 15000 }],
          },
        }}
        advertiserProfile={{
          display_name: "You",
          account_verification_status: null,
          phone: "27821234567",
          masked_phone_public: "082 123 4567",
        }}
        linkedBusiness={{
          id: "business-1",
          business_name: "Nomsa Events",
          logo_url: null,
        }}
        showContactActions={false}
        showContactSummary
        layoutMode="review"
      />
    );

    expect(container.querySelector('article[data-layout-mode="review"]')).toBeTruthy();
    expect(screen.queryByTestId("promotion-contact-actions")).not.toBeInTheDocument();
    expect(screen.getByText("Your preview — only you can see this")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add to Calendar/i })).toBeInTheDocument();
    expect(trackContentViewSpy).toHaveBeenCalledWith(
      "promotion-1",
      "promotion",
      false,
      expect.any(Function)
    );

    expect(screen.getByText("Saved contact methods")).toBeInTheDocument();
    expect(screen.getByText("Phone call")).toBeInTheDocument();
    // Review previews use an h2 so the surrounding editor keeps its own h1.
    expect(screen.getByRole("heading", { level: 2, name: "Soweto Food Festival" })).toBeTruthy();
  });

  it("shows price, host trust note and ticket prices on the public page", () => {
    render(
      <PromotionDetailContent
        promotion={{
          id: "promotion-2",
          owner_id: "owner-1",
          business_id: null,
          title: "Jazz on the Lawn",
          description: "Live jazz.",
          promotion_type: "event",
          category: "Festival",
          category_key: "events_entertainment",
          photos: ["https://example.com/photo.jpg"],
          videos: [],
          video_thumbnail: null,
          price_cents: 25000,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          location_town: null,
          location_address: null,
          contact_methods: ["form"],
          start_date: "2099-03-10T16:00:00.000Z",
          end_date: "2099-03-10T20:00:00.000Z",
          boost_until: null,
          featured_until: null,
          view_count: 3,
          created_at: "2099-01-01T00:00:00.000Z",
          event_details: {
            early_bird_deadline: "2099-02-01",
            ticket_tiers: [
              { name: "General", price_cents: 25000 },
              { name: "Kids", price_cents: 0 },
            ],
          },
        }}
        advertiserProfile={{
          display_name: "Lerato",
          account_verification_status: null,
          phone: null,
          masked_phone_public: null,
        }}
        linkedBusiness={null}
      />
    );

    expect(screen.getByRole("heading", { level: 1, name: "Jazz on the Lawn" })).toBeTruthy();
    expect(screen.getAllByText("R250").length).toBeGreaterThan(0);
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Tue 10 Mar, 18:00 – 22:00")).toBeInTheDocument();
    expect(screen.getByText("1 February 2099")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hosted by" })).toBeInTheDocument();
    expect(screen.getByText(/Not ID reviewed yet/i)).toBeInTheDocument();
    expect(screen.getByTestId("promotion-contact-actions")).toBeInTheDocument();
  });
});

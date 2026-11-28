/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByText("Upcoming Event")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add to Calendar/i })).toBeInTheDocument();
    expect(trackContentViewSpy).toHaveBeenCalledWith(
      "promotion-1",
      "promotion",
      false,
      expect.any(Function)
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.getByText("Saved contact methods")).toBeInTheDocument();
    expect(screen.getByText("Phone Call")).toBeInTheDocument();
  });
  it("shows the verified position and business stickers on the linked business", () => {
    const futureStart = "2099-03-10T00:00:00.000Z";
    const futureEnd = "2099-03-12T00:00:00.000Z";
    render(
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
          owner_id: "owner-1",
          cipc_verified_at: "2026-10-01T00:00:00.000Z",
          seen_verified_at: null,
          owner_verified_role: "director",
          owner_position_title: "Director",
        }}
        showContactActions={false}
        showContactSummary
        layoutMode="review"
      />
    );

    expect(screen.getAllByText("Director").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/confirmed on CIPC records/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CIPC registered · checked/).length).toBeGreaterThan(0);
  });

  it("keeps a video clear: the Event chip and the logo follow under it, beside the title", () => {
    const { container } = render(
      <PromotionDetailContent
        promotion={{
          id: "promotion-video",
          owner_id: "owner-1",
          business_id: null,
          title: "Zululand Craft Market",
          description: "Crafts and food.",
          promotion_type: "event",
          category: null,
          category_key: null,
          photos: [],
          videos: ["https://example.com/video.mp4"],
          video_thumbnail: null,
          logo_url: "https://example.com/logo.png",
          price_cents: 0,
          price_negotiable: false,
          location_province: "KwaZulu-Natal",
          location_city: "Richards Bay",
          location_town: null,
          location_address: null,
          contact_methods: ["form"],
          start_date: "2099-03-10T08:00:00.000Z",
          end_date: "2099-03-10T15:00:00.000Z",
          boost_until: null,
          featured_until: null,
          view_count: 0,
          created_at: "2099-03-01T08:00:00.000Z",
        }}
        advertiserProfile={null}
        linkedBusiness={null}
        showContactActions={false}
        trackView={false}
      />
    );

    expect(container.querySelector("[data-post-caption]")).toBeNull();
    const heading = screen.getByRole("heading", { name: "Zululand Craft Market" });
    const chips = container.querySelector("[data-event-chips]");
    expect(chips).toHaveTextContent("Event");
    // The chips and the logo sit with the title, not over the video.
    expect(heading.closest(".space-y-2")?.contains(chips)).toBe(true);
    expect(heading.parentElement?.querySelector("img")).toBeTruthy();
    expect(screen.queryByAltText("Zululand Craft Market logo")).toBeNull();
  });

  // Roadmap M10.6: the showroom card's caption on the main photo (phones only).
  it.each([
    {
      tiers: [
        { name: "Adult", price_cents: 5000 },
        { name: "Child", price_cents: 2000 },
      ],
      price: 0,
      line: "From R20",
    },
    { tiers: [{ name: "Entry", price_cents: null }], price: 0, line: "Free entry" },
    { tiers: [], price: 15000, line: "R150" },
  ])(
    "puts the card's price line '$line', title and town on the photo",
    ({ tiers, price, line }) => {
      const { container } = render(
        <PromotionDetailContent
          promotion={{
            id: "promotion-caption",
            owner_id: "owner-1",
            business_id: null,
            title: "Zululand Craft Market",
            description: "Crafts and food.",
            promotion_type: "event",
            category: null,
            category_key: null,
            photos: ["https://example.com/photo.jpg"],
            videos: [],
            video_thumbnail: null,
            price_cents: price,
            price_negotiable: false,
            location_province: "KwaZulu-Natal",
            location_city: "Richards Bay",
            location_town: null,
            location_address: null,
            contact_methods: ["form"],
            start_date: "2099-03-10T08:00:00.000Z",
            end_date: "2099-03-10T15:00:00.000Z",
            boost_until: null,
            featured_until: null,
            view_count: 0,
            created_at: "2099-03-01T08:00:00.000Z",
            event_details: { ticket_tiers: tiers },
          }}
          advertiserProfile={null}
          linkedBusiness={null}
          showContactActions={false}
          trackView={false}
        />
      );

      const caption = container.querySelector("[data-post-caption]");
      expect(caption).toHaveAttribute("aria-hidden", "true");
      expect(caption).toHaveClass("md:hidden");
      expect(caption?.textContent?.replace(/ /g, " ")).toBe(
        `${line}Zululand Craft MarketRichards Bay`
      );
      // Screen readers hear the title once, in the page heading.
      expect(screen.getAllByRole("heading", { name: "Zululand Craft Market" })).toHaveLength(1);
    }
  );
  it("shows the new entry details in plain words, the ID line for 18+, and links once", () => {
    render(
      <PromotionDetailContent
        promotion={{
          id: "promotion-2",
          owner_id: "owner-1",
          business_id: null,
          title: "Soweto Jazz Night",
          description: "An evening of live jazz in Soweto with local artists.",
          promotion_type: "event",
          category: null,
          category_key: null,
          photos: ["https://example.com/photo.jpg"],
          videos: [],
          video_thumbnail: null,
          price_cents: 15000,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          location_town: "Soweto",
          location_address: null,
          contact_methods: ["form"],
          start_date: "2099-03-10T16:00:00.000Z",
          end_date: null,
          boost_until: null,
          featured_until: null,
          view_count: 0,
          created_at: "2099-03-01T00:00:00.000Z",
          event_details: {
            event_type: "festival_concert",
            age_restriction: "18_plus",
            doors_open: "17:30",
            ticket_sales: "door",
            gate_payment: ["cash", "card"],
            refund_policy: "full_until_days",
            refund_days: 7,
            dress_code: "Smart casual",
            recurring: "monthly",
            group_discount_available: true,
            website: "https://jazz.example.com",
            map_directions: "https://maps.app.goo.gl/jazz",
            social_links: {
              facebook: "https://facebook.com/jazz",
              youtube: "https://youtube.com/@jazz",
            },
          },
        }}
        advertiserProfile={{
          display_name: "Organiser",
          account_verification_status: null,
          phone: null,
          masked_phone_public: null,
        }}
        linkedBusiness={null}
        showContactActions={false}
        showContactSummary={false}
        layoutMode="review"
      />
    );

    for (const [label, value] of [
      ["Doors open", "17:30"],
      ["Tickets sold", "At the door"],
      ["Pay at the door", "Cash, Card"],
      ["Refunds", "Full refund until 7 days before"],
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText("ID will be checked at the door")).toBeInTheDocument();
    // Removed fields are no longer shown.
    expect(screen.queryByText("Smart casual")).not.toBeInTheDocument();
    expect(screen.queryByText("Recurring")).not.toBeInTheDocument();
    expect(screen.queryByText("Group discounts")).not.toBeInTheDocument();
    // Links are tappable, YouTube included, each shown once.
    expect(screen.getByRole("link", { name: "YouTube" })).toHaveAttribute(
      "href",
      "https://youtube.com/@jazz"
    );
    expect(screen.getAllByRole("link", { name: "Facebook" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Website" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Open location pin/ })).toBeInTheDocument();
  });
});

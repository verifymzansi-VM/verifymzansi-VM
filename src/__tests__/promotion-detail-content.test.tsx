/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

const { trackViewState } = vi.hoisted(() => ({
  trackViewState: {
    lastArgs: null as null | {
      targetId: string;
      targetType: string;
      enabled: boolean;
      onRecorded?: () => void;
    },
  },
}));

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
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/trust/trust-badge", () => ({
  TrustBadge: ({ level }: { level: number }) => <span>{level}</span>,
}));

vi.mock("@/app/promotion/[id]/promotion-contact-actions", () => ({
  PromotionContactActions: () => <div>Contact actions</div>,
}));

vi.mock("@/lib/utils/format", () => ({
  formatZAR: (cents: number) => `R ${(cents / 100).toFixed(2)}`,
}));

vi.mock("@/contexts/video-playback-context", () => ({
  useVideoPlaybackManager: () => ({
    register: vi.fn(),
    unregister: vi.fn(),
    updateVisibility: vi.fn(),
    requestPriority: vi.fn(),
    releasePriority: vi.fn(),
    claimExclusive: vi.fn(),
    releaseExclusive: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-track-content-view", () => ({
  useTrackContentView: (
    targetId: string,
    targetType: string,
    enabled = true,
    onRecorded?: () => void
  ) => {
    trackViewState.lastArgs = { targetId, targetType, enabled, onRecorded };
  },
}));

const { PromotionDetailContent } = await import("@/components/listings/promotion-detail-content");

describe("PromotionDetailContent", () => {
  it("increments the visible detail-page view count after a recorded view", async () => {
    render(
      <PromotionDetailContent
        promotion={{
          id: "promo-view",
          owner_id: "seller-1",
          business_id: null,
          title: "Viewed Event",
          description: "Count me once.",
          promotion_type: "event",
          category: "Live Music",
          category_key: "events_entertainment",
          photos: [],
          videos: [],
          video_thumbnail: null,
          price_cents: null,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          location_town: null,
          location_address: null,
          contact_methods: [],
          start_date: null,
          end_date: null,
          boost_until: null,
          featured_until: null,
          view_count: 4,
          created_at: "2026-03-08T00:00:00.000Z",
        }}
        advertiserProfile={null}
        linkedBusiness={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(screen.getByText("4")).toBeTruthy();

    await act(async () => {
      trackViewState.lastArgs?.onRecorded?.();
    });

    expect(screen.getByText("5")).toBeTruthy();
  });

  it("renders event state and readable contact method labels", () => {
    render(
      <PromotionDetailContent
        promotion={{
          id: "promo-1",
          owner_id: "seller-1",
          business_id: null,
          title: "Night Market",
          description: "Community food and craft event with live music and stalls.",
          promotion_type: "event",
          category: "Live Music",
          category_key: "events_entertainment",
          photos: [],
          videos: [],
          video_thumbnail: null,
          price_cents: 5000,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          location_town: null,
          location_address: null,
          contact_methods: ["call", "whatsapp", "form"],
          start_date: "2099-03-10T00:00:00.000Z",
          end_date: "2099-03-12T00:00:00.000Z",
          boost_until: null,
          featured_until: null,
          view_count: 12,
          created_at: "2026-03-08T00:00:00.000Z",
        }}
        advertiserProfile={{
          display_name: "You",
          account_verification_status: null,
          phone: null,
          masked_phone_public: null,
        }}
        linkedBusiness={null}
        showContactActions={false}
        showContactSummary
      />
    );

    expect(screen.getByText("Upcoming Event")).toBeTruthy();

    // Details section is collapsed by default — expand it to see contact methods
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(screen.getByText("Phone Call")).toBeTruthy();
    expect(screen.getByText("WhatsApp")).toBeTruthy();
    expect(screen.getByText("Contact Form")).toBeTruthy();
  });

  it("renders remaining videos before photos when a lead video exists", () => {
    const { container } = render(
      <PromotionDetailContent
        promotion={{
          id: "promo-2",
          owner_id: "seller-1",
          business_id: null,
          title: "Weekend Event",
          description: "A promotion with mixed media.",
          promotion_type: "event",
          category: "Live Music",
          category_key: "events_entertainment",
          photos: ["https://example.com/photo-1.jpg", "https://example.com/photo-2.jpg"],
          videos: ["https://example.com/video-1.mp4", "https://example.com/video-2.mp4"],
          video_thumbnail: "https://example.com/video-thumb.jpg",
          price_cents: null,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          location_town: null,
          location_address: null,
          contact_methods: [],
          start_date: null,
          end_date: null,
          boost_until: null,
          featured_until: null,
          view_count: 1,
          created_at: "2026-03-08T00:00:00.000Z",
        }}
        advertiserProfile={null}
        linkedBusiness={null}
      />
    );

    // Only the hero video is a <video> element; gallery uses poster images
    const videos = Array.from(container.querySelectorAll("video"));
    expect(videos).toHaveLength(1);
    expect(videos[0]).toHaveAttribute("src", "https://example.com/video-1.mp4");

    // Gallery should still contain buttons for the other media items
    const galleryButtons = screen.getAllByRole("button", { name: /view (video|photo)/i });
    expect(galleryButtons.length).toBeGreaterThanOrEqual(3);

    const photo = screen.getByAltText("Weekend Event photo 2");
    expect(photo).toBeTruthy();
  });

  it("swaps hero to a photo when its thumbnail is clicked", () => {
    const { container } = render(
      <PromotionDetailContent
        promotion={{
          id: "promo-3",
          owner_id: "seller-1",
          business_id: null,
          title: "Photo Switch Event",
          description: "Tap photo thumbnail to view it in the main screen.",
          promotion_type: "event",
          category: "Live Music",
          category_key: "events_entertainment",
          photos: ["https://example.com/photo-1.jpg", "https://example.com/photo-2.jpg"],
          videos: ["https://example.com/video-1.mp4"],
          video_thumbnail: "https://example.com/video-thumb.jpg",
          price_cents: null,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          location_town: null,
          location_address: null,
          contact_methods: [],
          start_date: null,
          end_date: null,
          boost_until: null,
          featured_until: null,
          view_count: 1,
          created_at: "2026-03-08T00:00:00.000Z",
        }}
        advertiserProfile={null}
        linkedBusiness={null}
      />
    );

    // Hero uses custom play/mute overlay instead of native controls
    expect(container.querySelector("video")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View photo 2" }));
    expect(container.querySelector("video")).toBeNull();
    const images = Array.from(container.querySelectorAll("img"));
    expect(
      images.some((img) => img.getAttribute("src") === "https://example.com/photo-2.jpg")
    ).toBe(true);
  });

  it("swipes to the next hero media item on touch devices", () => {
    const { container } = render(
      <PromotionDetailContent
        promotion={{
          id: "promo-swipe",
          owner_id: "seller-1",
          business_id: null,
          title: "Swipe Event",
          description: "Swipe through the event gallery.",
          promotion_type: "event",
          category: "Live Music",
          category_key: "events_entertainment",
          photos: ["https://example.com/photo-1.jpg"],
          videos: ["https://example.com/video-1.mp4"],
          video_thumbnail: "https://example.com/video-thumb.jpg",
          price_cents: null,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          location_town: null,
          location_address: null,
          contact_methods: [],
          start_date: null,
          end_date: null,
          boost_until: null,
          featured_until: null,
          view_count: 1,
          created_at: "2026-03-08T00:00:00.000Z",
        }}
        advertiserProfile={null}
        linkedBusiness={null}
      />
    );

    const heroVideo = container.querySelector("video");
    expect(heroVideo).toBeTruthy();

    fireEvent.touchStart(heroVideo!, {
      touches: [{ clientX: 260, clientY: 220 }],
    });
    fireEvent.touchEnd(heroVideo!, {
      changedTouches: [{ clientX: 120, clientY: 225 }],
    });

    const images = Array.from(container.querySelectorAll("img"));
    expect(
      images.some((img) => img.getAttribute("src") === "https://example.com/photo-1.jpg")
    ).toBe(true);
  });

  it("renders logo overlay when promotion has logo_url", () => {
    const { container } = render(
      <PromotionDetailContent
        promotion={{
          id: "promo-logo",
          owner_id: "seller-1",
          business_id: null,
          title: "Logo Event",
          description: "An event with its own logo.",
          promotion_type: "event",
          category: "Live Music",
          category_key: "events_entertainment",
          photos: ["https://example.com/photo-1.jpg"],
          videos: [],
          video_thumbnail: null,
          logo_url: "https://example.com/event-logo.png",
          price_cents: null,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          location_town: null,
          location_address: null,
          contact_methods: [],
          start_date: "2099-06-01T00:00:00.000Z",
          end_date: "2099-06-02T00:00:00.000Z",
          boost_until: null,
          featured_until: null,
          view_count: 0,
          created_at: "2026-04-10T00:00:00.000Z",
        }}
        advertiserProfile={null}
        linkedBusiness={null}
      />
    );

    const logoImg = container.querySelector('img[alt="Logo Event logo"]');
    expect(logoImg).toBeTruthy();
    expect(logoImg?.getAttribute("src")).toBe("https://example.com/event-logo.png");
  });

  it("falls back to linked business logo when promotion has no logo_url", () => {
    const { container } = render(
      <PromotionDetailContent
        promotion={{
          id: "promo-biz-logo",
          owner_id: "seller-1",
          business_id: "biz-1",
          title: "Business Linked Event",
          description: "This event uses the linked business logo.",
          promotion_type: "event",
          category: "Live Music",
          category_key: "events_entertainment",
          photos: ["https://example.com/photo-1.jpg"],
          videos: [],
          video_thumbnail: null,
          price_cents: null,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          location_town: null,
          location_address: null,
          contact_methods: [],
          start_date: "2099-06-01T00:00:00.000Z",
          end_date: "2099-06-02T00:00:00.000Z",
          boost_until: null,
          featured_until: null,
          view_count: 0,
          created_at: "2026-04-10T00:00:00.000Z",
        }}
        advertiserProfile={null}
        linkedBusiness={{
          id: "biz-1",
          business_name: "Test Business",
          logo_url: "https://example.com/business-logo.png",
        }}
      />
    );

    const logoImg = container.querySelector('img[alt="Business Linked Event logo"]');
    expect(logoImg).toBeTruthy();
    expect(logoImg?.getAttribute("src")).toBe("https://example.com/business-logo.png");
  });
});

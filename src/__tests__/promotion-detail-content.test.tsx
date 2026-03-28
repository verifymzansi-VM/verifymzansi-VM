/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
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

const { PromotionDetailContent } = await import("@/components/listings/promotion-detail-content");

describe("PromotionDetailContent", () => {
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

    const videos = Array.from(container.querySelectorAll("video"));
    expect(videos).toHaveLength(2);
    expect(videos[0]).toHaveAttribute("src", "https://example.com/video-1.mp4");
    expect(videos[1]).toHaveAttribute("src", "https://example.com/video-2.mp4");

    const secondVideo = videos[1];
    const photo = screen.getByAltText("Weekend Event photo 2");
    expect(secondVideo.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
});

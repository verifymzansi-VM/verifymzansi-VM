/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { businessTrackViewState } = vi.hoisted(() => ({
  businessTrackViewState: {
    onRecorded: undefined as (() => void) | undefined,
  },
}));

vi.mock("next/image", () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

vi.mock("lucide-react", async () => {
  const React = await import("react");
  const Icon = ({ name }: { name: string }) => <span data-testid={name} />;
  return {
    BedDouble: () => <Icon name="bed" />,
    Clock: () => <Icon name="clock" />,
    CreditCard: () => <Icon name="credit-card" />,
    Eye: () => <Icon name="eye" />,
    Facebook: () => <Icon name="facebook" />,
    Globe: () => <Icon name="globe" />,
    Instagram: () => <Icon name="instagram" />,
    Mail: () => <Icon name="mail" />,
    MapPin: () => <Icon name="map-pin" />,
    MessageCircle: () => <Icon name="message-circle" />,
    MessageSquare: () => <Icon name="message-square" />,
    Music2: () => <Icon name="music" />,
    Phone: () => <Icon name="phone" />,
    ShieldCheck: () => <Icon name="shield" />,
    Star: () => <Icon name="star" />,
    Store: () => <Icon name="store" />,
    Truck: () => <Icon name="truck" />,
    Twitter: () => <Icon name="twitter" />,
    Wrench: () => <Icon name="wrench" />,
  };
});

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/trust/trust-badge", () => ({
  TrustBadge: () => <span>trust</span>,
}));

vi.mock("@/components/shared/share-button", () => ({
  ShareButton: () => <button>share</button>,
}));

vi.mock("@/components/shared/report-dialog", () => ({
  ReportDialog: () => <button>report</button>,
}));

vi.mock("@/components/listings/business-gallery", () => ({
  BusinessGallery: () => <div>gallery</div>,
}));

vi.mock("@/components/listings/business-promo-video", () => ({
  BusinessPromoVideo: () => <div>promo-video</div>,
}));

vi.mock("@/components/listings/promotion-card", () => ({
  PromotionCard: () => <div>promotion-card</div>,
}));

vi.mock("@/lib/utils/media-url", () => ({
  normalizeMediaUrl: (value: string) => value,
}));

vi.mock("@/lib/utils/sanitize-html", () => ({
  safeExternalHref: (value: string) => value,
}));

vi.mock("@/types/enums", () => ({
  BUSINESS_CATEGORY_LABELS: { fashion_accessories: "Fashion" },
  BUSINESS_TYPE_LABELS: { standalone_shop: "Standalone Shop" },
}));

vi.mock("@/lib/utils/promotion-category", () => ({
  getPromotionCategoryDisplayLabel: () => "Category",
}));

vi.mock("@/lib/forms/business-type-details", () => ({
  hasBusinessDeliveryAvailable: () => false,
  PRIMARY_ORDER_CHANNEL_LABELS: {},
  WALK_IN_POLICY_LABELS: {},
}));

vi.mock("@/lib/constants/categories", () => ({
  BUSINESS_CATEGORIES: [],
  TOURISM_ACCOMMODATION_TYPES: [],
  TOURISM_CANCELLATION_POLICIES: [],
  TOURISM_PRICE_RANGES: [],
  TOURISM_SUBCATEGORIES: [],
  TOURISM_TOUR_DURATIONS: [],
  TOURISM_DIFFICULTY_LEVELS: [],
  TOURISM_AGE_RESTRICTIONS: [],
  TOURISM_VISIT_DURATIONS: [],
}));

vi.mock("@/lib/forms/business-category-details", () => ({
  getCategoryDetailFields: () => [],
}));

vi.mock("@/hooks/use-track-content-view", () => ({
  useTrackContentView: (
    _targetId: string,
    _targetType: string,
    _enabled = true,
    onRecorded?: () => void
  ) => {
    businessTrackViewState.onRecorded = onRecorded;
  },
}));

const { BusinessDetailContent } = await import("@/components/business/business-detail-content");

describe("BusinessDetailContent", () => {
  it("shows business views on the detail page and updates them after a recorded view", async () => {
    render(
      <BusinessDetailContent
        business={{
          id: "business-1",
          owner_id: "owner-1",
          business_name: "View Test Business",
          description: "Business description",
          status: "live",
          business_type: "standalone_shop",
          category: "fashion_accessories",
          subcategory: null,
          category_details: null,
          cover_photo: null,
          logo_url: null,
          cover_video: null,
          video_thumbnail: null,
          gallery_photos: [],
          social_links: null,
          operating_hours: null,
          services_offered: [],
          payment_methods_accepted: [],
          delivery_options: [],
          service_areas: null,
          location_city: "Richards Bay",
          location_province: "KwaZulu-Natal",
          location_town: null,
          location_address: null,
          phone: null,
          whatsapp: null,
          email: null,
          website: null,
          store_number: null,
          map_directions: null,
          business_details: null,
          layout_template: null,
          view_count: 9,
        }}
        trustLevel={null}
        ownerProfile={null}
        promotions={[]}
        showPromotions={false}
        showPublicActions={false}
      />
    );

    expect(screen.getByText("9 views")).toBeTruthy();

    await act(async () => {
      businessTrackViewState.onRecorded?.();
    });

    expect(screen.getByText("10 views")).toBeTruthy();
  });
});

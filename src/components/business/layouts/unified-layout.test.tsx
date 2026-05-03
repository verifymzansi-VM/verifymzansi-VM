/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnifiedLayout } from "./unified-layout";
import type {
  BusinessDetailRecord,
  BusinessOwnerRecord,
  BusinessPromotionRecord,
} from "@/components/business/business-detail-content";

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

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    asChild,
    ...props
  }: {
    children: React.ReactNode;
    className?: string;
    asChild?: boolean;
  }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button className={className} {...props}>
        {children}
      </button>
    ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/business/shared/business-sidebar-cards", () => ({
  ManagedByCard: () => <div>Managed by</div>,
  OperatingHoursCard: () => <div>Hours</div>,
  ShareReportRow: () => <div>Share Report</div>,
}));

vi.mock("@/components/business/shared/business-details-accordion", () => ({
  BusinessDetailsAccordion: () => <div>Details Accordion</div>,
}));

vi.mock("@/components/business/shared/sticky-contact-bar", () => ({
  StickyContactBar: () => <div>Sticky Contact</div>,
}));

vi.mock("@/components/ui/media-lightbox", () => ({
  MediaLightbox: () => null,
}));

vi.mock("@/components/ui/profile-video-player", () => ({
  ProfileVideoPlayer: ({ title }: { title: string }) => <video aria-label={`${title} video`} />,
}));

vi.mock("@/components/listings/promotion-card", () => ({
  PromotionCard: () => <div>Promotion Card</div>,
}));

const business: BusinessDetailRecord = {
  id: "business-1",
  owner_id: "owner-1",
  business_name: "Unified Studio",
  description: "Salon and beauty profile.",
  status: "live",
  business_type: "standalone_shop",
  category: "health_beauty_wellness",
  subcategory: null,
  category_details: null,
  cover_photo: "https://example.com/cover.jpg",
  logo_url: "https://example.com/logo.jpg",
  cover_video: "https://example.com/cover.mp4",
  video_thumbnail: "https://example.com/video-thumb.jpg",
  gallery_photos: ["https://example.com/gallery-1.jpg"],
  social_links: null,
  operating_hours: null,
  services_offered: ["Hair", "Braids"],
  payment_methods_accepted: ["cash"],
  delivery_options: null,
  service_areas: null,
  location_city: "Richards Bay",
  location_province: "KwaZulu-Natal",
  location_town: null,
  location_address: null,
  phone: "0720000000",
  whatsapp: null,
  email: null,
  website: null,
  store_number: null,
  map_directions: null,
  business_details: null,
  layout_template: null,
};

describe("UnifiedLayout", () => {
  it("does not render the profile identity overlay on the video slide", () => {
    render(
      <UnifiedLayout
        family="showroom"
        business={business}
        trustLevel={null}
        ownerProfile={null as BusinessOwnerRecord | null}
        promotions={[] as BusinessPromotionRecord[]}
        showPromotions={false}
        showPublicActions
        galleryPhotos={business.gallery_photos ?? []}
        deliveryAvailable={false}
      />
    );

    expect(screen.queryByAltText("Unified Studio logo")).not.toBeInTheDocument();
    expect(screen.queryByText("Featured Profile")).not.toBeInTheDocument();
  });

  it("keeps the profile identity overlay on photo slides", () => {
    render(
      <UnifiedLayout
        family="showroom"
        business={business}
        trustLevel={null}
        ownerProfile={null as BusinessOwnerRecord | null}
        promotions={[] as BusinessPromotionRecord[]}
        showPromotions={false}
        showPublicActions
        galleryPhotos={business.gallery_photos ?? []}
        deliveryAvailable={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "View cover photo" }));

    expect(screen.getByAltText("Unified Studio logo")).toBeInTheDocument();
    expect(screen.getByText("Featured Profile")).toBeInTheDocument();
  });

  it("keeps the cover photo as a distinct media step alongside the video and gallery photos", () => {
    render(
      <UnifiedLayout
        family="showroom"
        business={business}
        trustLevel={null}
        ownerProfile={null as BusinessOwnerRecord | null}
        promotions={[] as BusinessPromotionRecord[]}
        showPromotions={false}
        showPublicActions
        galleryPhotos={business.gallery_photos ?? []}
        deliveryAvailable={false}
      />
    );

    expect(screen.getByRole("button", { name: "View profile video" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View cover photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View photo 1" })).toBeInTheDocument();
  });

  it("shows visible media navigation controls for profile galleries", () => {
    render(
      <UnifiedLayout
        family="showroom"
        business={business}
        trustLevel={null}
        ownerProfile={null as BusinessOwnerRecord | null}
        promotions={[] as BusinessPromotionRecord[]}
        showPromotions={false}
        showPublicActions
        galleryPhotos={business.gallery_photos ?? []}
        deliveryAvailable={false}
      />
    );

    const previousButton = screen.getByRole("button", { name: "Previous media" });
    const nextButton = screen.getByRole("button", { name: "Next media" });

    expect(previousButton).toBeDisabled();
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);

    expect(previousButton).toBeEnabled();
    expect(screen.getByAltText("Unified Studio logo")).toBeInTheDocument();
  });

  it.each(["showroom", "professional", "tourism"] as const)(
    "keeps media navigation controls visible for %s profiles",
    (family) => {
      render(
        <UnifiedLayout
          family={family}
          business={{
            ...business,
            category: family === "tourism" ? "tourism_hospitality" : business.category,
          }}
          trustLevel={null}
          ownerProfile={null as BusinessOwnerRecord | null}
          promotions={[] as BusinessPromotionRecord[]}
          showPromotions={false}
          showPublicActions
          galleryPhotos={business.gallery_photos ?? []}
          deliveryAvailable={false}
        />
      );

      expect(screen.getByRole("button", { name: "Previous media" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next media" })).toBeInTheDocument();
    }
  );

  it("renders review mode without the sticky contact bar", () => {
    const { container } = render(
      <UnifiedLayout
        family="showroom"
        business={business}
        trustLevel={null}
        ownerProfile={null as BusinessOwnerRecord | null}
        promotions={[] as BusinessPromotionRecord[]}
        showPromotions={false}
        showPublicActions
        layoutMode="review"
        galleryPhotos={business.gallery_photos ?? []}
        deliveryAvailable={false}
      />
    );

    expect(container.querySelector('[data-layout-mode="review"]')).toBeTruthy();
    expect(screen.queryByText("Sticky Contact")).not.toBeInTheDocument();
  });
});

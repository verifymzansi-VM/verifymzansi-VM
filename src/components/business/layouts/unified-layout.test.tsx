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

vi.mock("@/components/business/shared/sticky-contact-bar", () => ({
  StickyContactBar: () => <div>Sticky Contact</div>,
}));

vi.mock("@/components/ui/media-lightbox", () => ({
  MediaLightbox: () => null,
}));

vi.mock("@/components/ui/profile-video-player", () => ({
  ProfileVideoPlayer: ({
    title,
    prioritizePoster,
    autoPlayOnMobile,
  }: {
    title: string;
    prioritizePoster: boolean;
    autoPlayOnMobile: boolean;
  }) => (
    <video
      aria-label={`${title} video`}
      data-poster-priority={prioritizePoster}
      data-mobile-autoplay={autoPlayOnMobile}
    />
  ),
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
  function renderPublic(overrides: Partial<BusinessDetailRecord>, family = "showroom" as const) {
    return render(
      <UnifiedLayout
        family={family}
        business={{ ...business, ...overrides }}
        trustLevel={null}
        ownerProfile={{ display_name: "Aphiwe" }}
        promotions={[]}
        showPromotions={false}
        showPublicActions
        galleryPhotos={[]}
        deliveryAvailable={false}
      />
    );
  }

  it("shows public holidays, open 24 hours and by appointment", () => {
    renderPublic({
      operating_hours: {
        Mon_Fri: "08:00 - 17:00",
        Public_holidays: "Closed",
        By_appointment: true,
      },
    });
    expect(screen.getByText("Public holidays")).toBeVisible();
    expect(screen.getByText("Closed")).toBeVisible();
    expect(screen.getByText("By appointment")).toBeVisible();
    renderPublic({ operating_hours: { Open_24_hours: true, Mon_Fri: "08:00 - 17:00" } });
    expect(screen.getByText("Open 24 hours")).toBeVisible();
  });

  it("shows payment methods with plain labels", () => {
    renderPublic({
      payment_methods_accepted: ["zapper", "card_machine", "cash_on_delivery", "instant_eft"],
    });
    for (const label of ["Zapper", "Card machine", "Cash on delivery", "Instant EFT"])
      expect(screen.getByText(label)).toBeVisible();
  });

  it("shows walk-ins, visitor features and the booking link for any business", () => {
    renderPublic({
      business_type: "home_business",
      category_details: { booking_url: "https://book.example.com/studio" },
      business_details: {
        type: "home_business",
        walk_in_policy: "walk_ins_welcome",
        visitor_features: ["parking", "wheelchair_access", "kid_friendly"],
      } as unknown as BusinessDetailRecord["business_details"],
    });
    expect(screen.getByText("Walk-ins welcome")).toBeVisible();
    const features = screen.getByRole("list", { name: "For visitors" });
    expect(features).toHaveTextContent("Parking");
    expect(features).toHaveTextContent("Wheelchair access");
    expect(features).toHaveTextContent("Kid-friendly");
    expect(screen.getByRole("link", { name: "Book online" })).toHaveAttribute(
      "href",
      "https://book.example.com/studio"
    );
    // Visit-only details do not draw the older home-business rows.
    expect(screen.queryByText("Service suburb")).not.toBeInTheDocument();
    expect(screen.queryByText("Appointment required")).not.toBeInTheDocument();
  });

  it("shows the website and social links once, as tappable links, YouTube included", () => {
    renderPublic({
      website: "https://studio.example.com",
      social_links: {
        facebook: "https://facebook.com/studio",
        youtube: "https://youtube.com/@studio",
      },
    });
    expect(screen.getAllByRole("link", { name: "Website" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Website" })).toHaveAttribute(
      "href",
      expect.stringContaining("https://studio.example.com")
    );
    expect(screen.getAllByRole("link", { name: "Facebook" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "YouTube" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /Visit website|Visit public website/ })).toBeNull();
  });

  it.each(["showroom", "tourism"] as const)(
    "shows details and contact methods without expanding %s profiles",
    (family) => {
      render(
        <UnifiedLayout
          family={family}
          business={{
            ...business,
            location_address: "12 Main Road",
            email: "hello@example.com",
            whatsapp: "0821234567",
            operating_hours: { Mon_Fri: "08:00 - 17:00" },
            delivery_options: ["courier"],
          }}
          trustLevel={null}
          ownerProfile={{ display_name: "Aphiwe" }}
          promotions={[]}
          showPromotions={false}
          showPublicActions
          galleryPhotos={[]}
          deliveryAvailable
        />
      );
      expect(screen.getByText("12 Main Road")).toBeVisible();
      expect(screen.getByText("08:00 - 17:00")).toBeVisible();
      expect(screen.getByText("Cash")).toBeVisible();
      expect(screen.getByText(/Delivery options: Courier/)).toBeVisible();
      expect(screen.getByRole("link", { name: "hello@example.com" })).toHaveAttribute(
        "href",
        "mailto:hello@example.com"
      );
      expect(screen.getByRole("link", { name: "WhatsApp 0821234567" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Send an enquiry" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "Payment & Delivery" })).not.toBeInTheDocument();
    }
  );

  it("draws no identity overlay over the video; on phones the logo sits beside the name", () => {
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

    // The video keeps a clear picture; the name and logo follow under it.
    const overlay = screen.getByText("Featured Profile").closest("[data-post-caption]");
    expect(overlay).toHaveClass("hidden");
    const heading = screen.getByRole("heading", { name: business.business_name });
    const logo = heading.parentElement?.querySelector("img");
    expect(logo).toHaveClass("md:hidden");
    expect(screen.getByLabelText("Unified Studio video")).toHaveAttribute(
      "data-poster-priority",
      "true"
    );
    expect(screen.getByLabelText("Unified Studio video")).toHaveAttribute(
      "data-mobile-autoplay",
      "false"
    );
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
    const overlay = screen.getByText("Featured Profile").closest("[data-post-caption]");
    // A repeat of the page heading: screen readers hear the name once.
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay).toHaveClass("bottom-0");
    expect(overlay).not.toHaveClass("md:hidden");
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

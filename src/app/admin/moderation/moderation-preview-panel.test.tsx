import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModerationPreviewPanel, type ModerationItem } from "./moderation-preview-panel";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/components/ui/video-with-poster", () => ({
  VideoWithPoster: ({
    src,
    posterUrl,
    mediaFit,
  }: {
    src: string;
    posterUrl?: string;
    mediaFit?: string;
  }) => (
    <div
      data-testid="video-with-poster"
      data-src={src}
      data-poster-url={posterUrl ?? ""}
      data-media-fit={mediaFit ?? ""}
    />
  ),
}));

vi.mock("@/lib/utils/format", () => ({
  formatRelativeTime: () => "2 minutes ago",
  formatZAR: (value: number) => `R ${value}`,
}));

const baseItem: ModerationItem = {
  id: "listing-1",
  title: "Toyota Hilux 2019",
  status: "pending_moderation",
  created_at: "2026-03-28T10:00:00.000Z",
  category: "vehicles",
  owner_id: "user-1",
  area: "MZANSI_MARKET",
  areaLabel: "Mzansi Market",
  itemType: "Listing",
  price_cents: 45000000,
  photos: [],
  videos: [],
};

const baseBusinessItem: ModerationItem = {
  id: "business-1",
  title: "Nomsa Beauty Studio",
  business_name: "Nomsa Beauty Studio",
  business_type: "mall_store",
  status: "pending_moderation",
  created_at: "2026-03-28T10:00:00.000Z",
  category: "health_beauty",
  owner_id: "user-2",
  area: "MZANSI_BUSINESS",
  areaLabel: "Mzansi Business",
  itemType: "Business",
};

describe("ModerationPreviewPanel", () => {
  it("uses a mobile-safe scroll container and responsive details grid", () => {
    const { container } = render(
      <ModerationPreviewPanel
        item={{
          ...baseItem,
          attributes: {
            condition: "used",
            mileage: 123000,
            transmission: "manual",
          },
        }}
      />
    );

    expect(container.querySelector("div.h-full.min-h-0.overflow-auto")).toBeInTheDocument();
    expect(container.querySelector(".grid.grid-cols-1.sm\\:grid-cols-2")).toBeInTheDocument();
  });

  it("renders listing videos with a dedicated video player and video thumbnail poster", () => {
    render(
      <ModerationPreviewPanel
        item={{
          ...baseItem,
          videos: ["https://bucket.r2.cloudflarestorage.com/listings/video-1.mp4"],
          video_thumbnail: "https://bucket.r2.cloudflarestorage.com/listings/video-thumb.jpg",
        }}
      />
    );

    expect(screen.getByTestId("video-with-poster")).toHaveAttribute(
      "data-src",
      "/api/media/serve/listings/video-1.mp4"
    );
    expect(screen.getByTestId("video-with-poster")).toHaveAttribute(
      "data-poster-url",
      "/api/media/serve/listings/video-thumb.jpg"
    );
    expect(screen.getByTestId("video-with-poster")).toHaveAttribute("data-media-fit", "contain");
  });

  it("uses contain fitting for moderation video previews and photo thumbnails", () => {
    render(
      <ModerationPreviewPanel
        item={{
          ...baseItem,
          photos: ["https://bucket.r2.cloudflarestorage.com/listings/photo-1.jpg"],
          videos: ["https://bucket.r2.cloudflarestorage.com/listings/video-1.mp4"],
          video_thumbnail: "https://bucket.r2.cloudflarestorage.com/listings/video-thumb.jpg",
        }}
      />
    );

    expect(screen.getByAltText(/image 1/i)).toHaveClass("object-contain");

    fireEvent.click(screen.getByAltText("Video thumbnail").closest("button")!);

    expect(screen.getByTestId("video-with-poster")).toHaveAttribute("data-media-fit", "contain");
  });

  it("keeps .mov moderation uploads classified as video instead of image", () => {
    render(
      <ModerationPreviewPanel
        item={{
          ...baseItem,
          videos: ["https://bucket.r2.cloudflarestorage.com/listings/video-2.mov"],
          video_thumbnail: "https://bucket.r2.cloudflarestorage.com/listings/video-thumb-2.jpg",
        }}
      />
    );

    expect(screen.getByTestId("video-with-poster")).toHaveAttribute(
      "data-src",
      "/api/media/serve/listings/video-2.mov"
    );
    expect(screen.queryByAltText(/image 1/i)).toBeNull();
  });

  it("falls back to first photo as the video poster when video_thumbnail is missing", () => {
    render(
      <ModerationPreviewPanel
        item={{
          ...baseItem,
          photos: ["https://bucket.r2.cloudflarestorage.com/listings/photo-1.jpg"],
          videos: ["https://bucket.r2.cloudflarestorage.com/listings/video-3.mp4"],
          video_thumbnail: null,
        }}
      />
    );

    fireEvent.click(screen.getByAltText("Video thumbnail").closest("button")!);

    expect(screen.getByTestId("video-with-poster")).toHaveAttribute(
      "data-poster-url",
      "/api/media/serve/listings/photo-1.jpg"
    );
  });

  it("renders a rich business moderation view with location, contacts, and typed details", () => {
    render(
      <ModerationPreviewPanel
        item={{
          ...baseBusinessItem,
          description: "Full-service beauty studio for hair, nails, and makeup.",
          location_city: "Johannesburg",
          location_province: "Gauteng",
          store_number: "L42",
          phone: "011 555 0101",
          whatsapp: "0720000000",
          email: "hello@nomsa.co.za",
          website: "https://nomsa.co.za",
          services_offered: ["Hair styling", "Nail care"],
          payment_methods_accepted: ["cash", "card"],
          delivery_options: ["delivery"],
          cover_photo: "https://bucket.r2.cloudflarestorage.com/businesses/cover.jpg",
          cover_video: "https://bucket.r2.cloudflarestorage.com/businesses/video.mp4",
          gallery_photos: [
            "https://bucket.r2.cloudflarestorage.com/businesses/gallery-1.jpg",
            "https://bucket.r2.cloudflarestorage.com/businesses/gallery-2.jpg",
          ],
          logo_url: "https://bucket.r2.cloudflarestorage.com/businesses/logo.jpg",
          business_details: {
            type: "mall_store",
            mall_name: "Maponya Mall",
            floor_or_wing: "Upper Level",
            nearest_entrance: "Entrance 3",
          },
        }}
      />
    );

    expect(screen.getByText("Nomsa Beauty Studio")).toBeInTheDocument();
    expect(screen.getByText("Mall Store")).toBeInTheDocument();
    expect(screen.getByText("Health, Beauty & Wellness")).toBeInTheDocument();
    expect(screen.getByText("Johannesburg, Gauteng")).toBeInTheDocument();
    expect(screen.getByText("011 555 0101")).toBeInTheDocument();
    expect(screen.getByText("Hair styling")).toBeInTheDocument();
    expect(screen.getByText("Maponya Mall")).toBeInTheDocument();
    expect(screen.getByText("Upper Level")).toBeInTheDocument();
    expect(screen.getByText("Business media")).toBeInTheDocument();
    expect(screen.getByText("Cover photo")).toBeInTheDocument();
    expect(screen.getByText("Promo video")).toBeInTheDocument();
    expect(screen.getByText("2 gallery photos")).toBeInTheDocument();
    expect(screen.getByTestId("business-logo-panel")).toBeInTheDocument();
    expect(screen.getByAltText("Nomsa Beauty Studio logo")).toBeInTheDocument();
    expect(screen.getByText("Delivery")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });

  it("shows a compact empty state when a business has no media", () => {
    render(
      <ModerationPreviewPanel
        item={{
          ...baseBusinessItem,
          cover_photo: null,
          cover_video: null,
          gallery_photos: [],
          logo_url: null,
        }}
      />
    );

    expect(screen.getByTestId("business-media-empty-state")).toBeInTheDocument();
    expect(screen.getByText("No business visuals submitted")).toBeInTheDocument();
    expect(screen.getByText("No cover photo")).toBeInTheDocument();
    expect(screen.getByText("No logo")).toBeInTheDocument();
    expect(screen.queryByTestId("business-logo-panel")).not.toBeInTheDocument();
  });

  it("renders mobile service business-specific review details", () => {
    render(
      <ModerationPreviewPanel
        item={{
          ...baseBusinessItem,
          business_type: "mobile_service",
          category: "trade_maintenance",
          service_areas: { areas: ["Soweto", "Roodepoort"] },
          business_details: {
            type: "mobile_service",
            travel_radius_km: 25,
            emergency_callouts: true,
          },
        }}
      />
    );

    expect(screen.getByText("Mobile Service")).toBeInTheDocument();
    expect(screen.getByText("Trade & Maintenance")).toBeInTheDocument();
    expect(screen.getByText("25 km")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Soweto")).toBeInTheDocument();
    expect(screen.getByText("Roodepoort")).toBeInTheDocument();
  });
});

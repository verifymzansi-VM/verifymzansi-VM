import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModerationPreviewPanel, type ModerationItem } from "./moderation-preview-panel";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/components/ui/video-with-poster", () => ({
  VideoWithPoster: ({ src, posterUrl }: { src: string; posterUrl?: string }) => (
    <div data-testid="video-with-poster" data-src={src} data-poster-url={posterUrl ?? ""} />
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

describe("ModerationPreviewPanel", () => {
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
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/media-url", () => ({
  normalizeMediaUrl: (v: string) => `https://cdn.test/${v}`,
}));

import {
  listingToCarouselItem,
  businessToCarouselItem,
  promotionToCarouselItem,
} from "./carousel-item-transforms";

/* ── listingToCarouselItem ─────────────────────────────── */

describe("listingToCarouselItem", () => {
  const base = {
    id: "l1",
    title: "Blue Widget",
    description: "A fine widget",
    photos: ["/photo.jpg"],
    videos: ["/video.mp4"],
    video_thumbnail: "/thumb.jpg",
    logo_url: "/logo.png",
    price_cents: 9900,
    location_city: "Cape Town",
    location_province: "Western Cape",
    focal_x: 0.3,
    focal_y: 0.7,
    media_width: 1080,
    media_height: 1920,
  };

  it("maps all fields correctly", () => {
    const item = listingToCarouselItem(base);
    expect(item).toMatchObject({
      id: "l1",
      type: "listing",
      href: "/listing/l1",
      title: "Blue Widget",
      description: "A fine widget",
      location: "Cape Town",
      price: 99,
      focalX: 0.3,
      focalY: 0.7,
      mediaWidth: 1080,
      mediaHeight: 1920,
    });
    // video takes priority over photo
    expect(item.mediaUrl).toContain("/video.mp4");
    expect(item.posterUrl).toContain("/thumb.jpg");
    expect(item.logoUrl).toContain("/logo.png");
    expect(item.eyebrow).toMatch(/R\s*99/);
  });

  it("uses hrefOverride when provided", () => {
    expect(listingToCarouselItem(base, "/custom").href).toBe("/custom");
  });

  it("falls back photo → fallback when no video", () => {
    const item = listingToCarouselItem({ ...base, videos: null });
    expect(item.mediaUrl).toContain("/photo.jpg");
  });

  it("falls back to SVG when no video or photo", () => {
    const item = listingToCarouselItem({ ...base, videos: null, photos: null });
    expect(item.mediaUrl).toContain("hero-listing.svg");
  });

  it("uses photo as posterUrl when no video_thumbnail", () => {
    const item = listingToCarouselItem({ ...base, video_thumbnail: null });
    expect(item.posterUrl).toContain("/photo.jpg");
  });

  it("returns undefined posterUrl when no thumbnail or photo", () => {
    const item = listingToCarouselItem({ ...base, video_thumbnail: null, photos: null });
    expect(item.posterUrl).toBeUndefined();
  });

  it("uses province when city is missing", () => {
    const item = listingToCarouselItem({ ...base, location_city: null });
    expect(item.location).toBe("Western Cape");
  });

  it("falls back to South Africa when no location", () => {
    const item = listingToCarouselItem({ ...base, location_city: null, location_province: null });
    expect(item.location).toBe("South Africa");
  });

  it("returns null price/eyebrow when no price_cents", () => {
    const item = listingToCarouselItem({ ...base, price_cents: null });
    expect(item.price).toBeNull();
    expect(item.eyebrow).toBeNull();
  });
});

/* ── businessToCarouselItem ────────────────────────────── */

describe("businessToCarouselItem", () => {
  const base = {
    id: "b1",
    business_name: "Safari Lodge",
    description: "A great lodge",
    cover_photo: "/cover.jpg",
    cover_video: "/cover.mp4",
    video_thumbnail: "/bthumb.jpg",
    logo_url: "/blogo.png",
    location_city: "Nelspruit",
    location_province: "Mpumalanga",
    focal_x: 0.5,
    focal_y: 0.5,
    media_width: 800,
    media_height: 600,
  };

  it("maps all fields correctly", () => {
    const item = businessToCarouselItem(base);
    expect(item).toMatchObject({
      id: "b1",
      type: "business",
      href: "/mzansi-business/b1",
      title: "Safari Lodge",
      description: "A great lodge",
      location: "Nelspruit",
      focalX: 0.5,
      focalY: 0.5,
    });
    expect(item.mediaUrl).toContain("/cover.mp4");
    expect(item.posterUrl).toContain("/bthumb.jpg");
    expect(item.logoUrl).toContain("/blogo.png");
  });

  it("uses hrefOverride when provided", () => {
    expect(businessToCarouselItem(base, "/custom-biz").href).toBe("/custom-biz");
  });

  it("falls back to cover_photo when no video", () => {
    const item = businessToCarouselItem({ ...base, cover_video: null });
    expect(item.mediaUrl).toContain("/cover.jpg");
  });

  it("falls back to SVG when no media", () => {
    const item = businessToCarouselItem({ ...base, cover_video: null, cover_photo: null });
    expect(item.mediaUrl).toContain("hero-business.svg");
  });

  it("returns undefined posterUrl when no thumbnail or photo", () => {
    const item = businessToCarouselItem({ ...base, video_thumbnail: null, cover_photo: null });
    expect(item.posterUrl).toBeUndefined();
  });

  it("has no price or eyebrow fields", () => {
    const item = businessToCarouselItem(base);
    expect(item.price).toBeUndefined();
    expect(item.eyebrow).toBeUndefined();
  });
});

/* ── promotionToCarouselItem ───────────────────────────── */

describe("promotionToCarouselItem", () => {
  const base = {
    id: "p1",
    title: "Food Festival",
    description: "Live music and food",
    photos: ["/event.jpg"],
    videos: ["/event.mp4"],
    video_thumbnail: "/ethumb.jpg",
    price_cents: 15000,
    location_city: "Durban",
    location_province: "KwaZulu-Natal",
    focal_x: null,
    focal_y: null,
    media_width: null,
    media_height: null,
  };

  it("maps all fields correctly", () => {
    const item = promotionToCarouselItem(base);
    expect(item).toMatchObject({
      id: "p1",
      type: "promotion",
      href: "/tourism-events/p1",
      title: "Food Festival",
      description: "Live music and food",
      location: "Durban",
      price: 150,
      focalX: null,
      focalY: null,
    });
    expect(item.mediaUrl).toContain("/event.mp4");
    expect(item.posterUrl).toContain("/ethumb.jpg");
    expect(item.eyebrow).toMatch(/R\s*150/);
  });

  it("uses hrefOverride when provided", () => {
    expect(promotionToCarouselItem(base, "/custom-event").href).toBe("/custom-event");
  });

  it("falls back to photo when no video", () => {
    const item = promotionToCarouselItem({ ...base, videos: null });
    expect(item.mediaUrl).toContain("/event.jpg");
  });

  it("falls back to area-branded SVG when no media", () => {
    const item = promotionToCarouselItem({ ...base, videos: null, photos: null });
    expect(item.mediaUrl).toContain("hero-shop.svg");
  });

  it("returns null price/eyebrow when no price_cents", () => {
    const item = promotionToCarouselItem({ ...base, price_cents: null });
    expect(item.price).toBeNull();
    expect(item.eyebrow).toBeNull();
  });
});

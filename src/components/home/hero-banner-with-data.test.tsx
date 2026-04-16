import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroBannerWithData } from "./hero-banner-with-data";

const { createClientMock, showroomCarouselMock, queryState } = vi.hoisted(() => {
  const queryState = new Map<
    string,
    {
      select: string | null;
      limit: number | null;
    }
  >();

  const businessRows = Array.from({ length: 6 }, (_, index) => ({
    id: `business-${index + 1}`,
    business_name: `Business ${index + 1}`,
    logo_url: `/logos/business-${index + 1}.png`,
    cover_photo: `/covers/business-${index + 1}.jpg`,
    cover_video: null,
    video_thumbnail: `/thumbs/business-${index + 1}.jpg`,
    description: `Business description ${index + 1}`,
    location_city: "Johannesburg",
    location_province: "Gauteng",
    focal_x: 0.4,
    focal_y: 0.6,
    media_width: 1080,
    media_height: 1920,
  }));

  const listingRows = Array.from({ length: 6 }, (_, index) => ({
    id: `listing-${index + 1}`,
    title: `Listing ${index + 1}`,
    description: `Listing description ${index + 1}`,
    price_cents: 100_000 + index,
    photos: [`/photos/listing-${index + 1}.jpg`],
    videos: index === 0 ? [`/videos/listing-${index + 1}.mp4`] : [],
    video_thumbnail: `/thumbs/listing-${index + 1}.jpg`,
    logo_url: `/logos/listing-${index + 1}.png`,
    location_city: "Cape Town",
    location_province: "Western Cape",
    category: "vehicles",
    focal_x: 0.5,
    focal_y: 0.5,
    media_width: 1080,
    media_height: 1920,
  }));

  const promotionRows = Array.from({ length: 6 }, (_, index) => ({
    id: `promotion-${index + 1}`,
    title: `Promotion ${index + 1}`,
    description: `Promotion description ${index + 1}`,
    promotion_type: "event",
    category: "community",
    category_key: "community",
    photos: [`/photos/promotion-${index + 1}.jpg`],
    videos: [],
    video_thumbnail: `/thumbs/promotion-${index + 1}.jpg`,
    location_city: "Durban",
    location_province: "KwaZulu-Natal",
    price_cents: 50_000 + index,
    focal_x: 0.45,
    focal_y: 0.55,
    media_width: 1080,
    media_height: 1920,
  }));

  const makeBuilder = (table: string, data: unknown[]) => ({
    select(selection: string) {
      queryState.set(table, { ...(queryState.get(table) ?? { limit: null }), select: selection });
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    limit(value: number) {
      queryState.set(table, { ...(queryState.get(table) ?? { select: null }), limit: value });
      return Promise.resolve({ data, error: null });
    },
  });

  const createClientMock = vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "businesses") {
        return makeBuilder(table, businessRows);
      }

      if (table === "listings") {
        return makeBuilder(table, listingRows);
      }

      if (table === "promotions") {
        return makeBuilder(table, promotionRows);
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  }));

  const showroomCarouselMock = vi.fn(({ items }: { items: Array<{ title: string }> }) => (
    <div data-testid="hero-showroom" data-count={items.length}>
      {items.map((item) => (
        <span key={item.title}>{item.title}</span>
      ))}
    </div>
  ));

  return {
    createClientMock,
    showroomCarouselMock,
    queryState,
    businessRows,
    listingRows,
    promotionRows,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

vi.mock("./placeholder-content-filter", () => ({
  isPlaceholderMarketplaceContent: () => false,
}));

vi.mock("@/components/showrooms/showroom-card-carousel", () => ({
  ShowroomCardCarousel: showroomCarouselMock,
}));

describe("HeroBannerWithData", () => {
  beforeEach(() => {
    queryState.clear();
    createClientMock.mockClear();
    showroomCarouselMock.mockClear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  it("builds a fifteen-card mixed showroom and requests focal media fields", async () => {
    render(await HeroBannerWithData());

    expect(screen.getByTestId("hero-showroom")).toHaveAttribute("data-count", "15");
    expect(screen.getByText("Business 5")).toBeInTheDocument();
    expect(screen.getByText("Listing 5")).toBeInTheDocument();
    expect(screen.getByText("Promotion 5")).toBeInTheDocument();

    expect(queryState.get("businesses")?.limit).toBe(15);
    expect(queryState.get("listings")?.limit).toBe(15);
    expect(queryState.get("promotions")?.limit).toBe(15);

    expect(queryState.get("businesses")?.select).toContain("focal_x");
    expect(queryState.get("businesses")?.select).toContain("media_width");
    expect(queryState.get("listings")?.select).toContain("location_province");
    expect(queryState.get("listings")?.select).toContain("media_height");
    expect(queryState.get("promotions")?.select).toContain("focal_y");
    expect(queryState.get("promotions")?.select).toContain("media_width");
  });
});

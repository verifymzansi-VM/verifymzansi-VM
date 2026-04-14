import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PromotionsPage from "./page";

const { mockCreateClient, mockCookies } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCookies: vi.fn(),
}));

const { carouselSpy } = vi.hoisted(() => ({
  carouselSpy: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/components/showrooms/showroom-card-carousel", () => ({
  ShowroomCardCarousel: (props: {
    items: Array<{ id: string; type: string }>;
    emptyTitle?: string;
    emptyDescription?: string;
  }) => {
    carouselSpy(props);
    return <div data-testid="showroom-card-carousel" />;
  },
}));

vi.mock("@/components/layout/trust-strip", () => ({
  TrustStrip: () => <div data-testid="trust-strip" />,
}));

vi.mock("./client", () => ({
  PromotionsExplorer: () => <div data-testid="promotions-explorer" />,
}));

vi.mock("@/lib/account/compat", () => ({
  getOwnerColumn: vi.fn().mockResolvedValue("owner_id"),
  withOwnerColumn: (fields: string) => fields,
}));

vi.mock("@/lib/utils/media-url", () => ({
  normalizeMediaUrl: (value: string) => value,
}));

vi.mock("@/lib/utils/placeholder-content", () => ({
  isPlaceholderMarketplaceContent: (title?: string | null, description?: string | null) => {
    const content = `${title ?? ""} ${description ?? ""}`.toLowerCase();
    return content.includes("placeholder");
  },
}));

vi.mock("@/components/home/playwright-fixture-filter", () => ({
  shouldHidePlaywrightFixtureRowWhenEnabled: () => false,
}));

vi.mock("@/lib/supabase/playwright-visual-fixtures", () => ({
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE: "playwright-hide-fixtures",
  shouldHidePlaywrightFixtures: () => false,
}));

function createQueryResult<T>(data: T) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: { data: T }) => unknown) => Promise.resolve(resolve({ data })),
  };

  return builder;
}

function createSupabaseClient({
  businesses,
  promotions,
}: {
  businesses: unknown[];
  promotions: unknown[];
}) {
  return {
    from: (table: string) => {
      if (table === "businesses") {
        return createQueryResult(businesses);
      }

      if (table === "promotions") {
        return createQueryResult(promotions);
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe("PromotionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    });
  });

  it("keeps event slides in the showroom when tourism has enough rows to fill the wider stack", async () => {
    mockCreateClient.mockResolvedValue(
      createSupabaseClient({
        businesses: Array.from({ length: 5 }, (_, index) => ({
          id: `business-${index + 1}`,
          business_name: `Tourism Business ${index + 1}`,
          description: "Valid tourism business",
          location_city: "Cape Town",
          location_province: "Western Cape",
          cover_photo: `/business-${index + 1}.jpg`,
          cover_video: null,
          video_thumbnail: null,
        })),
        promotions: [
          {
            id: "event-1",
            title: "Food Festival",
            description: "Valid live event",
            location_city: "Durban",
            location_province: "KwaZulu-Natal",
            photos: ["/event-1.jpg"],
            videos: [],
            video_thumbnail: null,
            price_cents: 15000,
          },
          {
            id: "event-2",
            title: "Beach Concert",
            description: "Another live event",
            location_city: "Gqeberha",
            location_province: "Eastern Cape",
            photos: ["/event-2.jpg"],
            videos: [],
            video_thumbnail: null,
            price_cents: 20000,
          },
        ],
      })
    );

    render(await PromotionsPage());

    expect(screen.getByTestId("showroom-card-carousel")).toBeInTheDocument();
    expect(carouselSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: "event-1", type: "promotion" }),
        ]),
      })
    );
    expect(carouselSpy.mock.calls[0]?.[0].items).toHaveLength(7);
  });

  it("overfetches before filtering so valid tourism slides survive placeholder rows", async () => {
    mockCreateClient.mockResolvedValue(
      createSupabaseClient({
        businesses: [
          ...Array.from({ length: 5 }, (_, index) => ({
            id: `placeholder-${index + 1}`,
            business_name: `Placeholder Tourism ${index + 1}`,
            description: "placeholder business",
            location_city: "Johannesburg",
            location_province: "Gauteng",
            cover_photo: `/placeholder-${index + 1}.jpg`,
            cover_video: null,
            video_thumbnail: null,
          })),
          {
            id: "business-6",
            business_name: "Safari Lodge",
            description: "Valid tourism business",
            location_city: "Nelspruit",
            location_province: "Mpumalanga",
            cover_photo: "/business-6.jpg",
            cover_video: null,
            video_thumbnail: null,
          },
          {
            id: "business-7",
            business_name: "Coastal Retreat",
            description: "Valid tourism business",
            location_city: "Knysna",
            location_province: "Western Cape",
            cover_photo: "/business-7.jpg",
            cover_video: null,
            video_thumbnail: null,
          },
        ],
        promotions: [],
      })
    );

    render(await PromotionsPage());

    expect(carouselSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: "business-6", type: "business" }),
          expect.objectContaining({ id: "business-7", type: "business" }),
        ]),
      })
    );
    expect(carouselSpy.mock.calls[0]?.[0].items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "tourism-events-empty" })])
    );
  });
});

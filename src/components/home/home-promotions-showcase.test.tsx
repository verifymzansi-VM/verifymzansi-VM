import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { HomePromotionsShowcase } from "./home-promotions-showcase";

const { promotionCardSpy } = vi.hoisted(() => ({
  promotionCardSpy: vi.fn(),
}));
const { businessPreviewCardSpy } = vi.hoisted(() => ({
  businessPreviewCardSpy: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
  }),
}));

vi.mock("./auto-scroll-rail", () => ({
  AutoScrollRail: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auto-scroll-rail">{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/listings/promotion-card", () => ({
  PromotionCard: (props: unknown) => {
    promotionCardSpy(props);
    return <div data-testid="promotion-card" />;
  },
}));

vi.mock("./business-preview-card", () => ({
  BusinessPreviewCard: (props: unknown) => {
    businessPreviewCardSpy(props);
    return <div data-testid="business-preview-card" />;
  },
}));

function createSupabaseMock(data: unknown[], tourismData: unknown[] = []) {
  let businessCallCount = 0;
  return {
    from: vi.fn((table: string) => {
      if (table === "promotions") {
        const builder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data }),
        };

        return builder;
      }

      if (table === "businesses") {
        businessCallCount++;
        if (businessCallCount === 1) {
          // Tourism businesses query: .select().eq().in().order().order().order().limit()
          const builder = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: tourismData }),
          };
          return builder;
        }
        // Business logos query: .select().in()
        const builder = {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [{ id: "biz-1", logo_url: "https://example.com/business-logo.jpg" }],
          }),
        };

        return builder;
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

describe("HomePromotionsShowcase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps live promotions to presentation props with boost and feature state", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabaseMock([
        {
          id: "promo-1",
          title: "Weekend Deal",
          price_cents: 15000,
          price_negotiable: false,
          photos: ["https://example.com/photo.jpg"],
          videos: ["https://example.com/video.mp4"],
          video_thumbnail: "https://example.com/thumb.jpg",
          category: "Fashion",
          category_key: "fashion_accessories",
          location_province: "Gauteng",
          location_city: "Soweto",
          promotion_type: "event",
          view_count: 42,
          boost_until: "2099-01-01T00:00:00.000Z",
          featured_until: "2099-01-02T00:00:00.000Z",
          end_date: "2099-01-05T00:00:00.000Z",
          created_at: "2026-03-01T00:00:00.000Z",
          business_id: "biz-1",
        },
      ]) as never
    );

    const ui = await HomePromotionsShowcase();
    render(ui);

    expect(screen.getByTestId("promotion-card")).toBeInTheDocument();
    const props = promotionCardSpy.mock.calls[0]?.[0] as {
      imageUrl: string;
      posterUrl: string;
      boosted: boolean;
      featured: boolean;
      logoUrl: string;
      disableNativeDrag: boolean;
    };
    expect(props.imageUrl).toBe("https://example.com/video.mp4");
    expect(props.posterUrl).toBe("https://example.com/thumb.jpg");
    expect(props.boosted).toBe(true);
    expect(props.featured).toBe(true);
    expect(props.logoUrl).toBe("https://example.com/business-logo.jpg");
    expect(props.disableNativeDrag).toBe(true);
  });

  it("renders live tourism businesses on the homepage showcase", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabaseMock(
        [],
        [
          {
            id: "tourism-1",
            business_name: "Zulu Lodge",
            business_type: "standalone_shop",
            cover_photo: "https://example.com/lodge.jpg",
            cover_video: null,
            video_thumbnail: null,
            logo_url: "https://example.com/lodge-logo.jpg",
            location_province: "KwaZulu-Natal",
            location_city: "Richards Bay",
            boost_until: "2099-01-01T00:00:00.000Z",
            featured_until: null,
            focal_x: 0.5,
            focal_y: 0.5,
            media_width: 1080,
            media_height: 1920,
          },
        ]
      ) as never
    );

    const ui = await HomePromotionsShowcase();
    render(ui);

    expect(screen.getByTestId("business-preview-card")).toBeInTheDocument();
    expect(businessPreviewCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "/mzansi-business/tourism-1",
        title: "Zulu Lodge",
        city: "Richards Bay",
      })
    );
  });

  it("renders an empty-state CTA when no promotions exist", async () => {
    vi.mocked(createClient).mockResolvedValue(createSupabaseMock([]) as never);

    const ui = await HomePromotionsShowcase();
    render(ui as React.ReactElement);
    expect(screen.getByRole("heading", { name: /Tourism & Events/i })).toBeInTheDocument();
    expect(screen.getByText("No events yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Create Event/i })).toHaveAttribute(
      "href",
      "/post/create-tourism"
    );
  });

  it("renders promotions inside the shared auto-scroll rail", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabaseMock([
        {
          id: "promo-2",
          title: "Grand Opening",
          price_cents: null,
          price_negotiable: false,
          photos: ["https://example.com/opening.jpg"],
          videos: [],
          video_thumbnail: null,
          category: "Events",
          category_key: "events",
          location_province: "Gauteng",
          location_city: "Pretoria",
          promotion_type: "event",
          view_count: 10,
          boost_until: null,
          featured_until: null,
          start_date: "2099-01-10T00:00:00.000Z",
          end_date: "2099-01-11T00:00:00.000Z",
          created_at: "2026-03-01T00:00:00.000Z",
        },
      ]) as never
    );

    const ui = await HomePromotionsShowcase();
    render(ui);

    expect(screen.getByTestId("auto-scroll-rail")).toBeInTheDocument();
  });

  it("interleaves tourism businesses and event promotions", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabaseMock(
        [
          {
            id: "event-1",
            title: "Beach Festival",
            price_cents: null,
            price_negotiable: false,
            photos: ["https://example.com/event.jpg"],
            videos: [],
            video_thumbnail: null,
            category: "Events",
            category_key: "events",
            location_province: "KwaZulu-Natal",
            location_city: "Durban",
            promotion_type: "event",
            view_count: 25,
            boost_until: null,
            featured_until: null,
            start_date: "2099-01-10T00:00:00.000Z",
            end_date: "2099-01-11T00:00:00.000Z",
            created_at: "2026-03-01T00:00:00.000Z",
          },
        ],
        [
          {
            id: "tourism-2",
            business_name: "Ocean View Guest House",
            business_type: "standalone_shop",
            cover_photo: "https://example.com/ocean.jpg",
            cover_video: null,
            video_thumbnail: null,
            logo_url: null,
            location_province: "KwaZulu-Natal",
            location_city: "Durban",
            boost_until: null,
            featured_until: null,
            focal_x: null,
            focal_y: null,
            media_width: null,
            media_height: null,
          },
        ]
      ) as never
    );

    const ui = await HomePromotionsShowcase();
    render(ui);

    expect(screen.getAllByTestId(/promotion-card|business-preview-card/)).toHaveLength(2);
    expect(screen.getAllByTestId("business-preview-card")).toHaveLength(1);
    expect(screen.getAllByTestId("promotion-card")).toHaveLength(1);
  });

  it("shows content instead of the empty state when tourism businesses exist without events", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabaseMock(
        [],
        [
          {
            id: "tourism-3",
            business_name: "Safari Camp",
            business_type: "standalone_shop",
            cover_photo: "https://example.com/safari.jpg",
            cover_video: null,
            video_thumbnail: null,
            logo_url: null,
            location_province: "Limpopo",
            location_city: "Polokwane",
            boost_until: null,
            featured_until: null,
            focal_x: null,
            focal_y: null,
            media_width: null,
            media_height: null,
          },
        ]
      ) as never
    );

    const ui = await HomePromotionsShowcase();
    render(ui);

    expect(screen.queryByText("No events yet.")).not.toBeInTheDocument();
    expect(screen.getByTestId("business-preview-card")).toBeInTheDocument();
  });

  it("filters placeholder promotions before rendering cards", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabaseMock([
        {
          id: "promo-seed",
          title: "[Seed] Launch Campaign",
          price_cents: null,
          price_negotiable: false,
          photos: ["https://example.com/seed.jpg"],
          videos: [],
          video_thumbnail: null,
          category: "Events",
          category_key: "events",
          location_province: "Gauteng",
          location_city: "Pretoria",
          promotion_type: "event",
          view_count: 10,
          boost_until: null,
          featured_until: null,
          start_date: "2099-01-10T00:00:00.000Z",
          end_date: "2099-01-11T00:00:00.000Z",
          created_at: "2026-03-01T00:00:00.000Z",
        },
        {
          id: "promo-live",
          title: "Grand Opening",
          price_cents: null,
          price_negotiable: false,
          photos: ["https://example.com/opening.jpg"],
          videos: [],
          video_thumbnail: null,
          category: "Events",
          category_key: "events",
          location_province: "Gauteng",
          location_city: "Pretoria",
          promotion_type: "event",
          view_count: 10,
          boost_until: null,
          featured_until: null,
          start_date: "2099-01-10T00:00:00.000Z",
          end_date: "2099-01-11T00:00:00.000Z",
          created_at: "2026-03-01T00:00:00.000Z",
        },
      ]) as never
    );

    const ui = await HomePromotionsShowcase();
    render(ui);

    expect(screen.getAllByTestId("promotion-card")).toHaveLength(1);
  });
});

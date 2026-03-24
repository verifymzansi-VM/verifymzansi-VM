import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { HomePromotionsShowcase } from "./home-promotions-showcase";

const { promotionCardSpy } = vi.hoisted(() => ({
  promotionCardSpy: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
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

function createSupabaseMock(data: unknown[]) {
  return {
    from: vi.fn((table: string) => {
      if (table === "promotions") {
        const builder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data }),
        };

        return builder;
      }

      if (table === "businesses") {
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
          promotion_type: "deal",
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
    };
    expect(props.imageUrl).toBe("https://example.com/video.mp4");
    expect(props.posterUrl).toBe("https://example.com/thumb.jpg");
    expect(props.boosted).toBe(true);
    expect(props.featured).toBe(true);
    expect(props.logoUrl).toBe("https://example.com/business-logo.jpg");
  });

  it("renders an empty-state CTA when no promotions exist", async () => {
    vi.mocked(createClient).mockResolvedValue(createSupabaseMock([]) as never);

    const ui = await HomePromotionsShowcase();
    render(ui as React.ReactElement);
    expect(screen.getByRole("heading", { name: /Promotions & Events/i })).toBeInTheDocument();
    expect(
      screen.getByText("No promotions yet. Be the first to post a promotion or event.")
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Create Promotion/i })).toHaveAttribute(
      "href",
      "/post/create-promotion"
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

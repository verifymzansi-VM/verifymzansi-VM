import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
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

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
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
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data }),
  };

  return {
    from: vi.fn().mockReturnValue(builder),
  };
}

describe("HomePromotionsShowcase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-value");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps live promotions to presentation props with boost and feature state", async () => {
    vi.mocked(createClient).mockReturnValue(
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
    };
    expect(props.imageUrl).toBe("https://example.com/video.mp4");
    expect(props.posterUrl).toBe("https://example.com/thumb.jpg");
    expect(props.boosted).toBe(true);
    expect(props.featured).toBe(true);
  });

  it("returns null when Supabase env is absent", async () => {
    vi.unstubAllEnvs();

    const ui = await HomePromotionsShowcase();
    expect(ui).toBeNull();
  });
});

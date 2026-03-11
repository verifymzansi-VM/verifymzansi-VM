import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeMzansiMarketShowcase } from "./home-mzansi-market-showcase";
import { createClient } from "@/lib/supabase/server";

const { marketCardSpy } = vi.hoisted(() => ({
  marketCardSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("./auto-scroll-rail", () => ({
  AutoScrollRail: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auto-scroll-rail">{children}</div>
  ),
}));

vi.mock("./market-preview-card", () => ({
  MarketPreviewCard: (props: unknown) => {
    marketCardSpy(props);
    return <div data-testid="market-preview-card" />;
  },
}));

function createSupabaseMock(data: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data }),
  };

  return {
    from: vi.fn().mockReturnValue(builder),
  };
}

describe("HomeMzansiMarketShowcase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers listing video when available and passes it as imageUrl", async () => {
    const supabase = createSupabaseMock([
      {
        id: "list-1",
        title: "Laptop",
        price_cents: 150000,
        videos: ["https://example.com/video.mp4"],
        video_thumbnail: "https://example.com/thumb.jpg",
        photos: ["https://example.com/photo.jpg"],
        location_city: "Pretoria",
        location_province: "Gauteng",
        boost_until: null,
      },
    ]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const ui = await HomeMzansiMarketShowcase();
    render(ui);

    expect(screen.getByTestId("market-preview-card")).toBeInTheDocument();
    const props = marketCardSpy.mock.calls[0]?.[0] as {
      imageUrl: string;
      posterUrl: string;
    };
    expect(props.imageUrl).toBe("https://example.com/video.mp4");
    expect(props.posterUrl).toBe("https://example.com/thumb.jpg");
  });

  it("falls back to first photo when listing has no video", async () => {
    const supabase = createSupabaseMock([
      {
        id: "list-2",
        title: "Fridge",
        price_cents: 90000,
        videos: [],
        video_thumbnail: null,
        photos: ["https://example.com/fridge.jpg"],
        location_city: "Durban",
        location_province: "KwaZulu-Natal",
        boost_until: null,
      },
    ]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const ui = await HomeMzansiMarketShowcase();
    render(ui);

    const props = marketCardSpy.mock.calls[0]?.[0] as {
      imageUrl: string;
    };
    expect(props.imageUrl).toBe("https://example.com/fridge.jpg");
  });

  it("renders listings inside the shared auto-scroll rail", async () => {
    const supabase = createSupabaseMock([
      {
        id: "list-3",
        title: "Sofa",
        price_cents: 450000,
        videos: [],
        video_thumbnail: null,
        photos: ["https://example.com/sofa.jpg"],
        location_city: "Cape Town",
        location_province: "Western Cape",
        boost_until: null,
      },
    ]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const ui = await HomeMzansiMarketShowcase();
    render(ui);

    expect(screen.getByTestId("auto-scroll-rail")).toBeInTheDocument();
  });

  it("returns null when no listings are available", async () => {
    const supabase = createSupabaseMock([]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const ui = await HomeMzansiMarketShowcase();
    expect(ui).toBeNull();
  });
});

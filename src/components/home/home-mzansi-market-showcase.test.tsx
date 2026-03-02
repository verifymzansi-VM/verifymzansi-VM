import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeMzansiMarketShowcase } from "./home-mzansi-market-showcase";
import { createClient } from "@/lib/supabase/server";

const { areaCardSpy } = vi.hoisted(() => ({
  areaCardSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("./area-preview-card", () => ({
  AreaPreviewCard: (props: unknown) => {
    areaCardSpy(props);
    return <div data-testid="area-preview-card" />;
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

describe("HomeMzansiMarketShowcase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers listing video when available and flags card as video", async () => {
    const supabase = createSupabaseMock([
      {
        id: "list-1",
        title: "Laptop",
        description: "High-end gaming laptop",
        price_cents: 150000,
        videos: ["https://example.com/video.mp4"],
        photos: ["https://example.com/photo.jpg"],
        location_city: "Pretoria",
        location_province: "Gauteng",
        boost_until: null,
      },
    ]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const ui = await HomeMzansiMarketShowcase();
    render(ui);

    expect(screen.getByTestId("area-preview-card")).toBeInTheDocument();
    const props = areaCardSpy.mock.calls[0]?.[0] as {
      imageUrl: string;
      hasVideo: boolean;
    };
    expect(props.imageUrl).toBe("https://example.com/video.mp4");
    expect(props.hasVideo).toBe(true);
  });

  it("falls back to first photo when listing has no video", async () => {
    const supabase = createSupabaseMock([
      {
        id: "list-2",
        title: "Fridge",
        description: "Double-door fridge",
        price_cents: 90000,
        videos: [],
        photos: ["https://example.com/fridge.jpg"],
        location_city: "Durban",
        location_province: "KwaZulu-Natal",
        boost_until: null,
      },
    ]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const ui = await HomeMzansiMarketShowcase();
    render(ui);

    const props = areaCardSpy.mock.calls[0]?.[0] as {
      imageUrl: string;
      hasVideo: boolean;
    };
    expect(props.imageUrl).toBe("https://example.com/fridge.jpg");
    expect(props.hasVideo).toBe(false);
  });

  it("returns null when no listings are available", async () => {
    const supabase = createSupabaseMock([]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const ui = await HomeMzansiMarketShowcase();
    expect(ui).toBeNull();
  });
});

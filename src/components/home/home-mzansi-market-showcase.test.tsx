import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeMzansiMarketShowcase } from "./home-mzansi-market-showcase";
import { restoredHomeCollection } from "@/lib/foundation/marketplace-server";

const { marketCardSpy, warnSpy } = vi.hoisted(() => ({
  marketCardSpy: vi.fn(),
  warnSpy: vi.fn(),
}));

vi.mock("@/lib/foundation/marketplace-server", () => ({
  restoredHomeCollection: vi.fn(),
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

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
  }),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnSpy,
    error: vi.fn(),
  }),
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

function mockHomeCollection({
  data,
  error = null,
}: {
  data: unknown[];
  error?: { message: string } | null;
}) {
  vi.mocked(restoredHomeCollection).mockResolvedValue({ data, error } as never);
}

describe("HomeMzansiMarketShowcase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers listing video when available", async () => {
    mockHomeCollection({
      data: [
        {
          id: "list-1",
          title: "Laptop",
          price_cents: 150000,
          videos: ["https://example.com/video.mp4"],
          video_thumbnail: "https://example.com/thumb.jpg",
          photos: ["https://example.com/photo.jpg"],
          logo_url: "https://example.com/logo.jpg",
          location_city: "Pretoria",
          location_province: "Gauteng",
          boost_until: null,
        },
      ],
    });

    const ui = await HomeMzansiMarketShowcase();
    render(ui);

    expect(screen.getByTestId("market-preview-card")).toBeInTheDocument();
    const props = marketCardSpy.mock.calls[0]?.[0] as {
      imageUrl: string;
      posterUrl: string;
      logoUrl?: string;
    };
    expect(props.imageUrl).toBe("https://example.com/video.mp4");
    expect(props.posterUrl).toBe("https://example.com/thumb.jpg");
    expect(props.logoUrl).toBe("https://example.com/logo.jpg");
  });

  it("falls back to first photo when listing has no video", async () => {
    mockHomeCollection({
      data: [
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
      ],
    });

    const ui = await HomeMzansiMarketShowcase();
    render(ui);

    const props = marketCardSpy.mock.calls[0]?.[0] as {
      imageUrl: string;
    };
    expect(props.imageUrl).toBe("https://example.com/fridge.jpg");
  });

  it("renders listings inside the shared auto-scroll rail", async () => {
    mockHomeCollection({
      data: [
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
      ],
    });

    const ui = await HomeMzansiMarketShowcase();
    render(ui);

    expect(screen.getByTestId("auto-scroll-rail")).toBeInTheDocument();
  });

  it("renders a branded empty state when no listings are available", async () => {
    mockHomeCollection({ data: [] });

    const ui = await HomeMzansiMarketShowcase();
    render(ui);

    expect(screen.getByText("No listings yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /post a listing/i })).toHaveAttribute(
      "href",
      "/post/create-listing"
    );
  });

  it("filters placeholder listings before rendering the rail", async () => {
    mockHomeCollection({
      data: [
        {
          id: "list-seed",
          title: "[Seed] Demo Laptop",
          description: "Seed content",
          price_cents: 1000,
          videos: [],
          video_thumbnail: null,
          photos: ["https://example.com/seed.jpg"],
          location_city: "Pretoria",
          location_province: "Gauteng",
          boost_until: null,
        },
        {
          id: "list-live",
          title: "MacBook Pro",
          description: "Clean and ready for sale",
          price_cents: 150000,
          videos: [],
          video_thumbnail: null,
          photos: ["https://example.com/macbook.jpg"],
          location_city: "Pretoria",
          location_province: "Gauteng",
          boost_until: null,
        },
      ],
    });

    const ui = await HomeMzansiMarketShowcase();
    render(ui);

    expect(screen.getByTestId("market-preview-card")).toBeInTheDocument();
    expect(marketCardSpy).toHaveBeenCalledTimes(1);
    const props = marketCardSpy.mock.calls[0]?.[0] as { title: string };
    expect(props.title).toBe("MacBook Pro");
  });

  it("returns null and logs a warning when the listings query fails", async () => {
    mockHomeCollection({
      data: [],
      error: { message: "column listings.logo_url does not exist" },
    });

    const ui = await HomeMzansiMarketShowcase();

    expect(ui).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith("Failed to load home Mzansi Market showcase", {
      error: "column listings.logo_url does not exist",
    });
  });
});

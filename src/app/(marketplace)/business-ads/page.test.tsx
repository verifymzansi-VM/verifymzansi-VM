import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import BusinessAdsPage from "./page";
import { createClient } from "@/lib/supabase/server";

const { showroomHeroSpy } = vi.hoisted(() => ({
  showroomHeroSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/components/showrooms/showroom-hero", () => ({
  ShowroomHero: (props: unknown) => {
    showroomHeroSpy(props);
    return <div data-testid="showroom-hero" />;
  },
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: () => <div data-testid="page-header" />,
}));

vi.mock("@/components/listings/business-ad-category-strip", () => ({
  BusinessAdCategoryStrip: () => <div data-testid="category-strip" />,
}));

vi.mock("@/components/listings/business-directory-sidebar", () => ({
  BusinessDirectorySidebar: () => <div data-testid="directory-sidebar" />,
}));

vi.mock("@/components/listings/business-ad-header", () => ({
  BusinessAdHeader: () => <div data-testid="business-header" />,
}));

vi.mock("./grid", () => ({
  BusinessAdsGrid: () => <div data-testid="business-grid" />,
}));

vi.mock("@/components/listings/listing-skeleton", () => ({
  ListingGridSkeleton: () => <div data-testid="listing-grid-skeleton" />,
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

describe("BusinessAdsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps city + province from service_areas into slide location", async () => {
    const supabase = createSupabaseMock([
      {
        id: "biz-1",
        business_name: "Jabu Plumbing",
        about: "Trusted local plumber",
        cover_photo: "https://example.com/cover.jpg",
        cover_video: null,
        service_areas: { city: "Johannesburg", province: "Gauteng" },
        boost_until: null,
      },
    ]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const ui = await BusinessAdsPage();
    render(ui);

    expect(screen.getByTestId("showroom-hero")).toBeInTheDocument();
    const heroProps = showroomHeroSpy.mock.calls[0]?.[0] as {
      slides: Array<{ location: string }>;
    };
    expect(heroProps.slides[0].location).toBe("Johannesburg, Gauteng");
  });

  it("falls back to South Africa when service_areas is malformed", async () => {
    const supabase = createSupabaseMock([
      {
        id: "biz-2",
        business_name: "Cape Services",
        about: "General services",
        cover_photo: "https://example.com/cover.jpg",
        cover_video: null,
        service_areas: { regions: ["Western Cape"] },
        boost_until: null,
      },
    ]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const ui = await BusinessAdsPage();
    render(ui);

    const heroProps = showroomHeroSpy.mock.calls[0]?.[0] as {
      slides: Array<{ location: string }>;
    };
    expect(heroProps.slides[0].location).toBe("South Africa");
  });

  it("passes an empty slide list when no businesses are returned", async () => {
    const supabase = createSupabaseMock([]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const ui = await BusinessAdsPage();
    render(ui);

    const heroProps = showroomHeroSpy.mock.calls[0]?.[0] as {
      slides: unknown[];
    };
    expect(heroProps.slides).toEqual([]);
  });
});

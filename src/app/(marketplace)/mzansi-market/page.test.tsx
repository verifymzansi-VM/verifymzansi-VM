import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MzansiMarketPage from "./page";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

const { carouselSpy, pageHeaderSpy, areaHeroSpy } = vi.hoisted(() => ({
  carouselSpy: vi.fn(),
  pageHeaderSpy: vi.fn(),
  areaHeroSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/components/showrooms/showroom-card-carousel", () => ({
  ShowroomCardCarousel: (props: {
    items: Array<{ id: string; type: string }>;
    background?: { src?: string; overlayPreset?: string };
  }) => {
    carouselSpy(props);
    return <div data-testid="showroom-card-carousel" />;
  },
}));

vi.mock("@/components/layout/area-hero", () => ({
  AreaHero: (props: { title?: string; area?: string; ctaHref?: string }) => {
    areaHeroSpy(props);
    return <div data-testid="area-hero" />;
  },
}));

vi.mock("./grid", () => ({
  MzansiMarketGrid: () => <div data-testid="mzansi-market-grid" />,
}));

vi.mock("./url-filter-sync", () => ({
  MarketplaceUrlFilterSync: () => null,
}));

vi.mock("@/components/layout", () => ({
  PageHeader: ({ children, ...props }: { children?: React.ReactNode; title?: string }) => {
    pageHeaderSpy(props);
    return <div>{children}</div>;
  },
}));

vi.mock("@/components/listings/listing-filter-sidebar", () => ({
  ListingFilterSidebar: () => <div />,
}));

vi.mock("@/components/listings/listing-filter-drawer", () => ({
  ListingFilterDrawer: () => <div />,
}));

vi.mock("@/components/listings/listing-grid-header", () => ({
  ListingGridHeader: () => <div />,
}));

vi.mock("@/lib/utils/placeholder-content", () => ({
  isPlaceholderMarketplaceContent: () => false,
}));

vi.mock("@/components/home/playwright-fixture-filter", () => ({
  shouldHidePlaywrightFixtureRowWhenEnabled: () => false,
}));

vi.mock("@/lib/supabase/playwright-visual-fixtures", () => ({
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE: "playwright-hide-fixtures",
  shouldHidePlaywrightFixtures: () => false,
}));

vi.mock("@/lib/utils/request-context", () => ({
  getOptionalCookieStore: vi.fn().mockResolvedValue(undefined),
  readCookieValue: vi.fn().mockReturnValue(undefined),
}));

function createListingsQuery(data: unknown[]) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: { data: unknown[] }) => unknown) => Promise.resolve(resolve({ data })),
  };

  return builder;
}

describe("MzansiMarketPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      from: vi.fn(() => createListingsQuery([])),
    });
  });

  it("passes the market decorative background into the showroom", async () => {
    render(await MzansiMarketPage());

    expect(carouselSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        background: expect.objectContaining({
          src: "/images/showrooms/market-v2-desktop.avif",
          overlayPreset: "market",
        }),
      })
    );
  });

  it("introduces the market route with its area hero", async () => {
    render(await MzansiMarketPage());

    expect(areaHeroSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        area: "market",
        title: "Mzansi Market",
        ctaHref: "/post/create-listing",
      })
    );
  });

  it("uses Mzansi Market as the only primary page heading", async () => {
    render(await MzansiMarketPage());

    // The area hero owns the h1; the grid section uses an h2.
    expect(pageHeaderSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 2, name: "Latest listings" })).toBeInTheDocument();
  });
});

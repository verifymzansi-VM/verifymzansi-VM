import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MzansiMarketPage from "./page";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

const { carouselSpy, pageHeaderSpy, trustStripSpy } = vi.hoisted(() => ({
  carouselSpy: vi.fn(),
  pageHeaderSpy: vi.fn(),
  trustStripSpy: vi.fn(),
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

vi.mock("@/components/layout/trust-strip", () => ({
  TrustStrip: (props: { title?: string; variant?: string }) => {
    trustStripSpy(props);
    return <div data-testid="trust-strip" />;
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
          src: "/images/showrooms/generated-mzansi-showroom.webp",
          overlayPreset: "market",
        }),
      })
    );
  });

  it("labels the trust strip for the market route", async () => {
    render(await MzansiMarketPage());

    expect(trustStripSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "green",
        title: "Latest on Mzansi Market",
      })
    );
  });

  it("uses Mzansi Market as the primary page heading", async () => {
    render(await MzansiMarketPage());

    expect(pageHeaderSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Mzansi Market" }));
  });
});

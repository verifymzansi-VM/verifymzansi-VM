import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MzansiBusinessPage from "./page";

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
    background?: { src?: string; overlayPreset?: string };
  }) => {
    carouselSpy(props);
    return <div data-testid="showroom-card-carousel" />;
  },
}));

vi.mock("@/components/layout/trust-strip", () => ({
  TrustStrip: () => <div data-testid="trust-strip" />,
}));

vi.mock("./grid", () => ({
  MzansiBusinessGrid: () => <div data-testid="mzansi-business-grid" />,
}));

vi.mock("./filter-sync", () => ({
  MzansiBusinessFilterSync: () => null,
}));

vi.mock("@/components/layout", () => ({
  PageHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/listings/listing-skeleton", () => ({
  ListingGridSkeleton: () => <div />,
}));

vi.mock("./discovery-bar", () => ({
  BusinessDiscoveryBar: () => <div />,
}));

vi.mock("@/components/listings/business-filter-drawer", () => ({
  BusinessFilterDrawer: () => <div />,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div />,
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

function createBusinessesQuery(data: unknown[]) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: { data: unknown[] }) => unknown) => Promise.resolve(resolve({ data })),
  };

  return builder;
}

describe("MzansiBusinessPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    });
    mockCreateClient.mockResolvedValue({
      from: vi.fn(() => createBusinessesQuery([])),
    });
  });

  it("passes the business decorative background into the showroom", async () => {
    render(await MzansiBusinessPage());

    expect(carouselSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        background: expect.objectContaining({
          src: "/images/showrooms/mzansi-business-cafe.jpg",
          overlayPreset: "business",
        }),
      })
    );
  });
});

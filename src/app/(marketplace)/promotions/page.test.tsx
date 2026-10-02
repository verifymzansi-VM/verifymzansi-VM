import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PromotionsPage from "./page";

const { mockCreateClient, mockCookies, mockGetOwnerColumn } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCookies: vi.fn(),
  mockGetOwnerColumn: vi.fn(),
}));

const { carouselSpy, mockLoadShowroomItems, mockGetVisitorProvince } = vi.hoisted(() => ({
  carouselSpy: vi.fn(),
  mockLoadShowroomItems: vi.fn(),
  mockGetVisitorProvince: vi.fn(),
}));

vi.mock("@/lib/showroom/feed", () => ({
  loadShowroomItems: mockLoadShowroomItems,
}));

vi.mock("@/lib/showroom/visitor-province", () => ({
  getVisitorProvince: mockGetVisitorProvince,
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
    emptyTitle?: string;
    emptyDescription?: string;
    background?: { src?: string; overlayPreset?: string };
  }) => {
    carouselSpy(props);
    return <div data-testid="showroom-card-carousel" />;
  },
}));

vi.mock("./client", () => ({
  PromotionsExplorer: () => <div data-testid="promotions-explorer" />,
}));

vi.mock("@/lib/account/compat", () => ({
  getOwnerColumn: mockGetOwnerColumn,
  withOwnerColumn: (fields: string) => fields,
}));

vi.mock("@/lib/utils/media-url", () => ({
  normalizeMediaUrl: (value: string) => value,
}));

vi.mock("@/lib/utils/placeholder-content", () => ({
  isPlaceholderMarketplaceContent: (title?: string | null, description?: string | null) => {
    const content = `${title ?? ""} ${description ?? ""}`.toLowerCase();
    return content.includes("placeholder");
  },
}));

vi.mock("@/components/home/playwright-fixture-filter", () => ({
  shouldHidePlaywrightFixtureRowWhenEnabled: () => false,
}));

vi.mock("@/lib/supabase/playwright-visual-fixtures", () => ({
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE: "playwright-hide-fixtures",
  shouldHidePlaywrightFixtures: () => false,
}));

function createQueryResult<T>(data: T) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: { data: T }) => unknown) => Promise.resolve(resolve({ data })),
  };

  return builder;
}

function createRejectedQueryResult(message = "Query failed") {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (_resolve: unknown, reject?: (reason: Error) => unknown) =>
      reject ? Promise.resolve(reject(new Error(message))) : Promise.reject(new Error(message)),
    catch: (reject: (reason: Error) => unknown) => Promise.resolve(reject(new Error(message))),
  };

  return builder;
}

function createSupabaseClient({
  businesses,
  promotions,
}: {
  businesses: unknown[];
  promotions: unknown[];
}) {
  return {
    from: (table: string) => {
      if (table === "businesses") {
        return createQueryResult(businesses);
      }

      if (table === "promotions") {
        return createQueryResult(promotions);
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe("PromotionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOwnerColumn.mockResolvedValue("owner_id");
    mockCookies.mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    });
    mockLoadShowroomItems.mockResolvedValue([]);
    mockGetVisitorProvince.mockResolvedValue({ province: null, source: null });
  });

  it("shows tourism businesses and events in fair rotation order, local first", async () => {
    const supabase = createSupabaseClient({ businesses: [], promotions: [] });
    mockCreateClient.mockResolvedValue(supabase);
    mockGetVisitorProvince.mockResolvedValue({ province: "Western Cape", source: "detected" });
    const items = [
      { id: "event-1", type: "promotion", href: "/tourism-events/event-1", title: "Event" },
      { id: "lodge-1", type: "business", href: "/tourism-events/lodge-1", title: "Lodge" },
    ];
    mockLoadShowroomItems.mockResolvedValue(items);

    render(await PromotionsPage());

    expect(mockLoadShowroomItems).toHaveBeenCalledWith("tourism", {
      province: "Western Cape",
      hideFixtures: false,
      client: supabase,
    });
    expect(carouselSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        items,
        surface: "showroom:tourism",
        visitorProvince: { province: "Western Cape", source: "detected" },
      })
    );
  });

  it("passes the tourism-led decorative background into the showroom", async () => {
    mockCreateClient.mockResolvedValue(
      createSupabaseClient({
        businesses: [],
        promotions: [],
      })
    );

    render(await PromotionsPage());

    expect(carouselSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        background: expect.objectContaining({
          src: "/images/showrooms/tourism-v2-desktop.avif",
          overlayPreset: "tourism",
        }),
      })
    );
  });

  it("shows no trust strip under the tourism showroom", async () => {
    mockCreateClient.mockResolvedValue(
      createSupabaseClient({
        businesses: [],
        promotions: [],
      })
    );

    render(await PromotionsPage());

    expect(screen.queryByText("Phone & ID checked")).not.toBeInTheDocument();
  });

  it("renders the tourism empty state when owner detection and hero queries fail", async () => {
    mockGetOwnerColumn.mockRejectedValue(new Error("Supabase probe failed"));
    mockCreateClient.mockResolvedValue({
      from: () => createRejectedQueryResult(),
    });

    render(await PromotionsPage());

    expect(screen.getByTestId("showroom-card-carousel")).toBeInTheDocument();
    expect(carouselSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining({ id: "tourism-events-empty" })]),
      })
    );
    expect(screen.queryByText("Phone & ID checked")).not.toBeInTheDocument();
  });
});

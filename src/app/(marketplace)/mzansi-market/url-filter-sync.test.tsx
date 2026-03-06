import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MarketplaceUrlFilterSync } from "./url-filter-sync";

const {
  replaceMock,
  usePathnameMock,
  useRouterMock,
  useSearchParamsMock,
  useMarketplaceStoreMock,
} = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  usePathnameMock: vi.fn(),
  useRouterMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
  useMarketplaceStoreMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useRouter: useRouterMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock("@/stores", () => ({
  useMarketplaceStore: useMarketplaceStoreMock,
}));

describe("MarketplaceUrlFilterSync", () => {
  const hydrateFilters = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/mzansi-market");
    useRouterMock.mockReturnValue({ replace: replaceMock });
    useMarketplaceStoreMock.mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) =>
        selector({
          hydrateFilters,
          filters: {
            category: "vehicles",
            query: "iphone",
            province: undefined,
            city: undefined,
            condition: undefined,
            sort: "newest",
            priceMin: undefined,
            priceMax: undefined,
            attributes: {},
          },
          page: 1,
        })
    );
  });

  it("hydrates canonical category and query from URL params", async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams("category=vehicles&q=iphone") as ReturnType<typeof useSearchParamsMock>
    );

    render(<MarketplaceUrlFilterSync />);

    await waitFor(() => {
      expect(hydrateFilters).toHaveBeenCalledWith(
        "MZANSI_MARKET",
        expect.objectContaining({
          category: "vehicles",
          query: "iphone",
          sort: "newest",
          attributes: {},
        }),
        1
      );
    });
    expect(replaceMock).toHaveBeenCalledWith("/mzansi-market?q=iphone&category=vehicles", {
      scroll: false,
    });
  });

  it("maps legacy category aliases and rewrites the canonical URL", async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams("category=cars") as ReturnType<typeof useSearchParamsMock>
    );

    useMarketplaceStoreMock.mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) =>
        selector({
          hydrateFilters,
          filters: {
            category: "vehicles",
            query: undefined,
            province: undefined,
            city: undefined,
            condition: undefined,
            sort: "newest",
            priceMin: undefined,
            priceMax: undefined,
            attributes: {},
          },
          page: 1,
        })
    );

    render(<MarketplaceUrlFilterSync />);

    await waitFor(() => {
      expect(hydrateFilters).toHaveBeenCalledWith(
        "MZANSI_MARKET",
        expect.objectContaining({
          category: "vehicles",
          query: undefined,
          sort: "newest",
          attributes: {},
        }),
        1
      );
    });
    expect(replaceMock).toHaveBeenCalledWith("/mzansi-market?category=vehicles", { scroll: false });
  });

  it("trims query and clears invalid or missing params", async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams("category=not_real&q=%20%20tv%20%20") as ReturnType<
        typeof useSearchParamsMock
      >
    );

    useMarketplaceStoreMock.mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) =>
        selector({
          hydrateFilters,
          filters: {
            category: undefined,
            query: "tv",
            province: undefined,
            city: undefined,
            condition: undefined,
            sort: "newest",
            priceMin: undefined,
            priceMax: undefined,
            attributes: {},
          },
          page: 1,
        })
    );

    render(<MarketplaceUrlFilterSync />);

    await waitFor(() => {
      expect(hydrateFilters).toHaveBeenCalledWith(
        "MZANSI_MARKET",
        expect.objectContaining({
          category: undefined,
          query: "tv",
        }),
        1
      );
    });
    expect(replaceMock).toHaveBeenCalledWith("/mzansi-market?q=tv", { scroll: false });
  });
});

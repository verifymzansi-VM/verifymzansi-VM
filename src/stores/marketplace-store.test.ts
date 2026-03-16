import { describe, it, expect, beforeEach } from "vitest";
import { cloneMarketplaceFilters, useMarketplaceStore } from "./marketplace-store";

describe("marketplace-store", () => {
  beforeEach(() => {
    useMarketplaceStore.setState({
      activeArea: "MZANSI_MARKET",
      filters: cloneMarketplaceFilters(),
      page: 1,
      isSearching: false,
    });
  });

  it("initialises with default filters", () => {
    const state = useMarketplaceStore.getState();
    expect(state.activeArea).toBe("MZANSI_MARKET");
    expect(state.filters.sort).toBe("newest");
    expect(state.page).toBe(1);
    expect(state.isSearching).toBe(false);
  });

  it("setActiveArea resets filters and page", () => {
    const { setActiveArea } = useMarketplaceStore.getState();
    setActiveArea("MZANSI_BUSINESS");
    const state = useMarketplaceStore.getState();
    expect(state.activeArea).toBe("MZANSI_BUSINESS");
    expect(state.filters.sort).toBe("newest");
    expect(state.page).toBe(1);
  });

  it("hydrateFilters sets area, filters, and page", () => {
    const { hydrateFilters } = useMarketplaceStore.getState();
    hydrateFilters("MZANSI_BUSINESS", { province: "Gauteng", sort: "price_asc" }, 3);
    const state = useMarketplaceStore.getState();
    expect(state.activeArea).toBe("MZANSI_BUSINESS");
    expect(state.filters.province).toBe("Gauteng");
    expect(state.filters.sort).toBe("price_asc");
    expect(state.page).toBe(3);
  });

  it("replaceFilters updates filters and resets page", () => {
    useMarketplaceStore.getState().setPage(5);
    useMarketplaceStore.getState().replaceFilters({ query: "shoes" });
    const state = useMarketplaceStore.getState();
    expect(state.filters.query).toBe("shoes");
    expect(state.page).toBe(1);
  });

  it("setFilter clears attributes when category changes", () => {
    const store = useMarketplaceStore.getState();
    store.setAttribute("size", "L");
    expect(useMarketplaceStore.getState().filters.attributes.size).toBe("L");
    useMarketplaceStore.getState().setFilter("category", "electronics");
    expect(useMarketplaceStore.getState().filters.attributes).toEqual({});
  });

  it("setFilter clears city when province changes", () => {
    useMarketplaceStore.getState().setFilter("city", "Johannesburg");
    useMarketplaceStore.getState().setFilter("province", "Western Cape");
    expect(useMarketplaceStore.getState().filters.city).toBeUndefined();
  });

  it("setAttribute sets attribute and resets page", () => {
    useMarketplaceStore.getState().setPage(3);
    useMarketplaceStore.getState().setAttribute("color", "red");
    const state = useMarketplaceStore.getState();
    expect(state.filters.attributes.color).toBe("red");
    expect(state.page).toBe(1);
  });

  it("resetFilters restores defaults", () => {
    useMarketplaceStore.getState().setFilter("query", "test");
    useMarketplaceStore.getState().setPage(5);
    useMarketplaceStore.getState().resetFilters();
    const state = useMarketplaceStore.getState();
    expect(state.filters.query).toBeUndefined();
    expect(state.page).toBe(1);
  });

  it("setSearching updates isSearching", () => {
    useMarketplaceStore.getState().setSearching(true);
    expect(useMarketplaceStore.getState().isSearching).toBe(true);
  });
});

describe("cloneMarketplaceFilters", () => {
  it("returns defaults when called with no args", () => {
    const filters = cloneMarketplaceFilters();
    expect(filters.sort).toBe("newest");
    expect(filters.attributes).toEqual({});
  });

  it("deep clones attributes", () => {
    const attrs = { color: "blue" };
    const filters = cloneMarketplaceFilters({ attributes: attrs });
    expect(filters.attributes).toEqual({ color: "blue" });
    expect(filters.attributes).not.toBe(attrs);
  });
});

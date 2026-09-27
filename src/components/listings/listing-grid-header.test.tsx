import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useMarketplaceStore } from "@/stores";
import { ListingGridHeader } from "./listing-grid-header";

describe("ListingGridHeader", () => {
  beforeEach(() => {
    act(() => {
      useMarketplaceStore.getState().setActiveArea("MZANSI_MARKET");
    });
  });

  it("names the sort trigger with the current sort, even where the label is hidden", () => {
    act(() => {
      useMarketplaceStore.getState().setFilter("sort", "price_asc");
    });
    render(<ListingGridHeader />);

    expect(screen.getByRole("button", { name: "Sort: Price: Low → High" })).toBeInTheDocument();
  });

  it("formats the price chip with Rand grouping instead of raw numbers", () => {
    act(() => {
      useMarketplaceStore
        .getState()
        .hydrateFilters("MZANSI_MARKET", { priceMin: 1000, priceMax: 25000 });
    });
    render(<ListingGridHeader />);

    // Groups use a non-breaking space ("R1 000"); the default matcher normalises it.
    expect(screen.getByText(/^R1\s000 – R25\s000$/)).toBeInTheDocument();
    expect(screen.queryByText(/∞/)).not.toBeInTheDocument();
  });

  it("skips empty multi-select attribute filters", () => {
    act(() => {
      useMarketplaceStore
        .getState()
        .hydrateFilters("MZANSI_MARKET", { attributes: { features: [] } });
    });
    render(<ListingGridHeader />);

    expect(screen.queryByRole("button", { name: /Remove features filter/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });
});

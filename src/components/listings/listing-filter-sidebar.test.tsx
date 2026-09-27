import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useMarketplaceStore } from "@/stores";
import { ListingFilterSidebar } from "./listing-filter-sidebar";

describe("ListingFilterSidebar", () => {
  beforeEach(() => {
    act(() => {
      useMarketplaceStore.getState().setActiveArea("MZANSI_MARKET");
    });
  });

  it("shows a deep-linked query once the URL filters hydrate after mount", () => {
    render(<ListingFilterSidebar />);
    expect(screen.getByLabelText("Search listings")).toHaveValue("");

    act(() => {
      useMarketplaceStore.getState().hydrateFilters("MZANSI_MARKET", { query: "phone" });
    });

    expect(screen.getByLabelText("Search listings")).toHaveValue("phone");
  });

  it("empties the search box when the query is cleared elsewhere", () => {
    act(() => {
      useMarketplaceStore.getState().hydrateFilters("MZANSI_MARKET", { query: "bakkie" });
    });
    render(<ListingFilterSidebar />);
    expect(screen.getByLabelText("Search listings")).toHaveValue("bakkie");

    act(() => {
      useMarketplaceStore.getState().setFilter("query", undefined);
    });

    expect(screen.getByLabelText("Search listings")).toHaveValue("");
  });

  it("labels the category select and exposes the condition toggle state", () => {
    render(<ListingFilterSidebar />);

    expect(screen.getByLabelText("Category").tagName).toBe("SELECT");
    const [firstCondition] = screen
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("aria-pressed"));
    expect(firstCondition).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(firstCondition);

    expect(firstCondition).toHaveAttribute("aria-pressed", "true");
  });

  it("links the price error to both price inputs", () => {
    act(() => {
      useMarketplaceStore
        .getState()
        .hydrateFilters("MZANSI_MARKET", { priceMin: 5000, priceMax: 100 });
    });
    render(<ListingFilterSidebar />);

    const error = screen.getByRole("alert");
    for (const label of ["Minimum price", "Maximum price"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAttribute("aria-describedby", error.id);
    }
  });
});

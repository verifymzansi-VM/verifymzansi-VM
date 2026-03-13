import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessDiscoveryBar } from "./discovery-bar";
import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";

const { useMarketplaceStoreMock } = vi.hoisted(() => ({
  useMarketplaceStoreMock: vi.fn(),
}));

vi.mock("@/stores", () => ({
  useMarketplaceStore: useMarketplaceStoreMock,
}));

vi.mock("@/hooks/use-debounce", () => ({
  useDebouncedCallback: (callback: (value: string) => void) => {
    const debounced = ((value: string) => callback(value)) as ((value: string) => void) & {
      cancel: () => void;
    };
    debounced.cancel = vi.fn();
    return debounced;
  },
}));

vi.mock("@/lib/constants/sa-provinces", () => ({
  getProvinceNames: () => ["Gauteng", "Western Cape"],
  getCitiesForProvince: (province: string) =>
    province === "Gauteng" ? ["Johannesburg", "Pretoria"] : ["Cape Town"],
}));

describe("BusinessDiscoveryBar", () => {
  const setFilter = vi.fn();
  const resetFilters = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useMarketplaceStoreMock.mockReturnValue({
      filters: {
        sort: "newest",
        attributes: {},
        query: undefined,
        businessCategory: undefined,
        businessType: undefined,
        province: undefined,
        city: undefined,
      },
      setFilter,
      resetFilters,
    });
  });

  it("renders the category select with shared business category options", () => {
    render(<BusinessDiscoveryBar />);

    const categorySelect = screen.getByLabelText("Category");
    expect(categorySelect).toBeInTheDocument();

    const options = screen.getAllByRole("option");
    expect(options.some((option) => option.textContent === "All categories")).toBe(true);

    for (const category of BUSINESS_CATEGORIES) {
      expect(screen.getByRole("option", { name: category.label })).toBeInTheDocument();
    }
  });

  it("updates and clears the business category filter from the dropdown", () => {
    render(<BusinessDiscoveryBar />);

    const categorySelect = screen.getByLabelText("Category");
    fireEvent.change(categorySelect, { target: { value: "food_dining" } });
    fireEvent.change(categorySelect, { target: { value: "" } });

    expect(setFilter).toHaveBeenNthCalledWith(1, "businessCategory", "food_dining");
    expect(setFilter).toHaveBeenNthCalledWith(2, "businessCategory", undefined);
  });

  it("shows the selected category badge and clears it from the badge control", () => {
    useMarketplaceStoreMock.mockReturnValue({
      filters: {
        sort: "newest",
        attributes: {},
        query: undefined,
        businessCategory: "fashion_accessories",
        businessType: undefined,
        province: undefined,
        city: undefined,
      },
      setFilter,
      resetFilters,
    });

    render(<BusinessDiscoveryBar />);

    expect(screen.getByText("Fashion & Accessories", { selector: "div" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove business category filter/i }));
    expect(setFilter).toHaveBeenCalledWith("businessCategory", undefined);
  });

  it("clears the query badge and resets the stored query", () => {
    useMarketplaceStoreMock.mockReturnValue({
      filters: {
        sort: "newest",
        attributes: {},
        query: "coffee",
        businessCategory: undefined,
        businessType: undefined,
        province: undefined,
        city: undefined,
      },
      setFilter,
      resetFilters,
    });

    render(<BusinessDiscoveryBar />);

    fireEvent.click(screen.getByRole("button", { name: /remove query filter coffee/i }));

    expect(setFilter).toHaveBeenCalledWith("query", undefined);
  });

  it("syncs the local search input when the store query changes externally", () => {
    let filters: {
      sort: "newest";
      attributes: Record<string, string | boolean | undefined>;
      query?: string;
      businessCategory?: string;
      businessType?: string;
      province?: string;
      city?: string;
    } = {
      sort: "newest",
      attributes: {},
      query: undefined,
      businessCategory: undefined,
      businessType: undefined,
      province: undefined,
      city: undefined,
    };

    const storeState = {
      get filters() {
        return filters;
      },
      set filters(nextFilters: typeof filters) {
        filters = nextFilters;
      },
      setFilter,
      resetFilters,
    };

    useMarketplaceStoreMock.mockImplementation(() => storeState);

    const { rerender } = render(<BusinessDiscoveryBar />);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "local draft" } });

    storeState.filters = { ...storeState.filters, query: "synced from store" };
    rerender(<BusinessDiscoveryBar />);

    expect(screen.getByLabelText("Search")).toHaveValue("synced from store");
  });

  it("applies the query filter when the search input changes", () => {
    render(<BusinessDiscoveryBar />);

    fireEvent.input(screen.getByLabelText("Search"), { target: { value: "coffee" } });

    return waitFor(() => {
      expect(setFilter).toHaveBeenCalledWith("query", "coffee");
    });
  });
});

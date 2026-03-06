import { fireEvent, render, screen } from "@testing-library/react";
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
  useDebouncedCallback: (callback: (value: string) => void) => callback,
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
        mall: undefined,
      },
      setFilter,
      resetFilters,
    });
  });

  it("renders the category select with shared business category options", () => {
    render(<BusinessDiscoveryBar malls={[]} />);

    const categorySelect = screen.getByLabelText("Category");
    expect(categorySelect).toBeInTheDocument();

    const options = screen.getAllByRole("option");
    expect(options.some((option) => option.textContent === "All categories")).toBe(true);

    for (const category of BUSINESS_CATEGORIES) {
      expect(screen.getByRole("option", { name: category.label })).toBeInTheDocument();
    }
  });

  it("updates and clears the business category filter from the dropdown", () => {
    render(<BusinessDiscoveryBar malls={[]} />);

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
        mall: undefined,
      },
      setFilter,
      resetFilters,
    });

    const { container } = render(<BusinessDiscoveryBar malls={[]} />);

    expect(screen.getByText("Fashion & Accessories", { selector: "div" })).toBeInTheDocument();

    const badgeIcon = container.querySelector("svg.h-3.w-3.cursor-pointer");
    expect(badgeIcon).not.toBeNull();

    fireEvent.click(badgeIcon!);
    expect(setFilter).toHaveBeenCalledWith("businessCategory", undefined);
  });
});

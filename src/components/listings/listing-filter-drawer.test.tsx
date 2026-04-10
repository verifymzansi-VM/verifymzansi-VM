import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListingFilterDrawer } from "./listing-filter-drawer";

const { useMarketplaceStoreMock } = vi.hoisted(() => ({
  useMarketplaceStoreMock: vi.fn(),
}));

vi.mock("@/stores", () => ({
  useMarketplaceStore: useMarketplaceStoreMock,
  cloneMarketplaceFilters: (filters: Record<string, unknown> = {}) => {
    const { attributes, ...rest } = filters;
    return {
      sort: "newest",
      ...rest,
      attributes: { ...((attributes as Record<string, unknown> | undefined) ?? {}) },
    };
  },
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("ListingFilterDrawer", () => {
  const replaceFilters = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useMarketplaceStoreMock.mockReturnValue({
      filters: {
        category: undefined,
        province: undefined,
        city: undefined,
        priceMin: undefined,
        priceMax: undefined,
        condition: undefined,
        sort: "newest",
        query: undefined,
        attributes: {},
      },
      replaceFilters,
    });
  });

  it("shows category-specific fields when a category is selected", () => {
    useMarketplaceStoreMock.mockReturnValue({
      filters: {
        category: "electronics",
        province: undefined,
        city: undefined,
        priceMin: undefined,
        priceMax: undefined,
        condition: undefined,
        sort: "newest",
        query: undefined,
        attributes: {},
      },
      replaceFilters,
    });

    render(<ListingFilterDrawer />);

    expect(screen.getByText("Electronics & Tech Filters")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Device Type" })).toBeInTheDocument();
    expect(screen.getByLabelText("Brand")).toBeInTheDocument();
  });

  it("keeps drawer edits local until show results and clears stale category attributes", () => {
    useMarketplaceStoreMock.mockReturnValue({
      filters: {
        category: "vehicles",
        province: undefined,
        city: undefined,
        priceMin: undefined,
        priceMax: undefined,
        condition: "good",
        sort: "newest",
        query: undefined,
        attributes: {
          make: "Toyota",
          model: "Corolla",
        },
      },
      replaceFilters,
    });

    render(<ListingFilterDrawer />);

    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
      target: { value: "electronics" },
    });

    expect(screen.queryByRole("combobox", { name: "Make" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Brand")).toBeInTheDocument();
    expect(replaceFilters).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Brand"), {
      target: { value: "Apple" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Show results" }));

    expect(replaceFilters).toHaveBeenCalledTimes(1);
    const submittedFilters = replaceFilters.mock.calls[0][0];
    expect(submittedFilters.category).toBe("electronics");
    expect(submittedFilters.condition).toBe("good");
    expect(submittedFilters.attributes).toEqual({ brand: "Apple" });
  });
});

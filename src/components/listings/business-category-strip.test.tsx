import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import { DEV_SEED_BUSINESS_CATEGORY_COUNTS } from "@/lib/testing/dev-seed-fixtures";
import { BusinessCategoryStrip } from "./business-category-strip";

const { useMarketplaceStoreMock } = vi.hoisted(() => ({
  useMarketplaceStoreMock: vi.fn(),
}));

vi.mock("@/stores", () => ({
  useMarketplaceStore: useMarketplaceStoreMock,
}));

describe("BusinessCategoryStrip", () => {
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
      setFilter: vi.fn(),
    });
  });

  it("renders every business category when seed counts include all categories", () => {
    render(<BusinessCategoryStrip categoryCounts={DEV_SEED_BUSINESS_CATEGORY_COUNTS} />);

    for (const category of BUSINESS_CATEGORIES) {
      expect(
        screen.getByRole("button", { name: new RegExp(category.label, "i") })
      ).toBeInTheDocument();
    }

    expect(screen.getAllByText("(1)")).toHaveLength(BUSINESS_CATEGORIES.length);
  });
});

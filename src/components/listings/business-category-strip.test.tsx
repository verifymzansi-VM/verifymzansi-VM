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
      },
      setFilter: vi.fn(),
    });
  });

  it("renders every business category when seed counts include all categories", () => {
    render(<BusinessCategoryStrip categoryCounts={DEV_SEED_BUSINESS_CATEGORY_COUNTS} />);

    const buttonTexts = screen.getAllByRole("button").map((button) => button.textContent ?? "");

    for (const category of BUSINESS_CATEGORIES) {
      expect(buttonTexts.some((text) => text.includes(category.label))).toBe(true);
    }

    expect(screen.getAllByText("(1)")).toHaveLength(BUSINESS_CATEGORIES.length);
  });
});

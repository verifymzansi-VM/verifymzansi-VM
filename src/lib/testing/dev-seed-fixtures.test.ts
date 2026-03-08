import { describe, expect, it } from "vitest";
import { BUSINESS_CATEGORIES, CATEGORIES } from "@/lib/constants/categories";
import {
  DEV_SEED_BUSINESS_CATEGORY_COUNTS,
  DEV_SEED_BUSINESS_FIXTURES,
  DEV_SEED_LISTING_FIXTURES,
  DEV_SEED_PROMOTION_CATEGORY_COUNTS,
  DEV_SEED_PROMOTION_FIXTURES,
} from "./dev-seed-fixtures";

function sortedValues(values: Iterable<string>) {
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

describe("development seed fixtures", () => {
  it("cover every Mzansi Market listing category", () => {
    expect(sortedValues(DEV_SEED_LISTING_FIXTURES.map((fixture) => fixture.category))).toEqual(
      sortedValues(CATEGORIES.map((category) => category.value))
    );

    for (const category of CATEGORIES) {
      expect(DEV_SEED_LISTING_FIXTURES.some((fixture) => fixture.category === category.value)).toBe(
        true
      );
    }
  });

  it("cover every Mzansi Business category in businesses", () => {
    expect(sortedValues(Object.keys(DEV_SEED_BUSINESS_CATEGORY_COUNTS))).toEqual(
      sortedValues(BUSINESS_CATEGORIES.map((category) => category.value))
    );

    for (const category of BUSINESS_CATEGORIES) {
      expect(DEV_SEED_BUSINESS_CATEGORY_COUNTS[category.value]).toBeGreaterThan(0);
    }
  });

  it("cover every promotion category and link promotions to matching seeded businesses", () => {
    expect(sortedValues(Object.keys(DEV_SEED_PROMOTION_CATEGORY_COUNTS))).toEqual(
      sortedValues(BUSINESS_CATEGORIES.map((category) => category.value))
    );

    for (const promotion of DEV_SEED_PROMOTION_FIXTURES) {
      const linkedBusiness = DEV_SEED_BUSINESS_FIXTURES.find(
        (business) => business.slug === promotion.business_slug
      );

      expect(
        linkedBusiness,
        `Missing business fixture for ${promotion.business_slug}`
      ).toBeTruthy();
      expect(linkedBusiness?.category).toBe(promotion.category_key);
    }
  });

  it("guarantee at least one category-filterable row for each surface", () => {
    for (const category of CATEGORIES) {
      expect(
        DEV_SEED_LISTING_FIXTURES.filter((fixture) => fixture.category === category.value)
      ).toHaveLength(1);
    }

    for (const category of BUSINESS_CATEGORIES) {
      expect(
        DEV_SEED_BUSINESS_FIXTURES.filter((fixture) => fixture.category === category.value)
      ).toHaveLength(1);
      expect(
        DEV_SEED_PROMOTION_FIXTURES.filter((fixture) => fixture.category_key === category.value)
      ).toHaveLength(1);
    }
  });
});

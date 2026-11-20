import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  parseBusinessFiltersFromSearchParams,
  parseMarketplaceFiltersFromSearchParams,
  serializeBusinessFiltersToSearchParams,
  serializeMarketplaceFiltersToSearchParams,
  type MarketSort,
} from "./marketplace-query";

// Property tests for the marketplace and directory query strings (see
// marketplace-query.test.ts for named examples).

const CATEGORIES = ["property", "vehicles", "electronics", "jobs_services", "baby_kids"];
const CONDITIONS = ["new", "like_new", "good", "fair", "for_parts"];
const SORTS: MarketSort[] = ["recommended", "newest", "price_asc", "price_desc", "popular"];
/** Text a person types into a box: trimmed, not empty. */
const text = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
/** A single attribute value as the URL keeps it (no commas, not a boolean word). */
const word = text.filter((value) => !value.includes(",") && value !== "true" && value !== "false");
const attribute = fc.oneof(fc.boolean(), word, fc.array(word, { minLength: 2, maxLength: 4 }));
const marketFilters = fc.record(
  {
    category: fc.constantFrom(...CATEGORIES),
    query: text,
    province: text,
    city: text,
    condition: fc.constantFrom(...CONDITIONS),
    sort: fc.constantFrom(...SORTS.filter((sort) => sort !== "recommended")),
    priceMin: fc.integer({ min: 0, max: 1e9 }),
    priceMax: fc.integer({ min: 0, max: 1e9 }),
    attributes: fc.dictionary(fc.stringMatching(/^[a-z][a-z_]{0,10}$/), attribute, {
      maxKeys: 4,
    }),
  },
  { requiredKeys: ["attributes"] }
);

describe("market filters in the query string", () => {
  it("read back exactly what was written, on any page", () => {
    fc.assert(
      fc.property(marketFilters, fc.integer({ min: 1, max: 500 }), (filters, page) => {
        const params = serializeMarketplaceFiltersToSearchParams(filters, page);
        const parsed = parseMarketplaceFiltersFromSearchParams(
          new URLSearchParams(params.toString())
        );
        expect(parsed).toEqual({
          category: filters.category,
          query: filters.query,
          province: filters.province,
          city: filters.city,
          condition: filters.condition,
          sort: filters.sort,
          priceMin: filters.priceMin,
          priceMax: filters.priceMax,
          page,
          attributes: filters.attributes,
        });
      })
    );
  });

  it("any query string parses to known values only, never throwing", () => {
    const key = fc.constantFrom(
      "category",
      "condition",
      "sort",
      "minPrice",
      "maxPrice",
      "page",
      "q",
      "attr_x"
    );
    fc.assert(
      fc.property(
        fc.array(fc.tuple(key, fc.string({ unit: "binary", maxLength: 12 })), { maxLength: 8 }),
        (pairs) => {
          const parsed = parseMarketplaceFiltersFromSearchParams(new URLSearchParams(pairs));
          expect(Number.isSafeInteger(parsed.page) && parsed.page >= 1).toBe(true);
          for (const price of [parsed.priceMin, parsed.priceMax])
            if (price !== undefined) expect(Number.isFinite(price) && price >= 0).toBe(true);
          if (parsed.sort) expect(SORTS).toContain(parsed.sort);
          if (parsed.condition) expect(CONDITIONS).toContain(parsed.condition);
          if (parsed.query !== undefined) expect(parsed.query).toBe(parsed.query.trim());
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe("directory filters in the query string", () => {
  const slug = fc.stringMatching(/^[a-z0-9]{1,10}(-[a-z0-9]{1,10}){0,3}$/);

  it("read back exactly what was written", () => {
    fc.assert(
      fc.property(
        text,
        text,
        text,
        slug,
        fc.integer({ min: 1, max: 99 }),
        (query, province, city, organisation, page) => {
          const params = serializeBusinessFiltersToSearchParams(
            {
              query,
              province,
              city,
              organisation,
              businessCategory: "food_dining",
              businessType: "market_stall",
            },
            page
          );
          expect(
            parseBusinessFiltersFromSearchParams(new URLSearchParams(params.toString()))
          ).toEqual({
            query,
            businessCategory: "food_dining",
            businessSubcategory: undefined,
            businessType: "market_stall",
            province,
            city,
            organisation,
            page,
          });
        }
      )
    );
  });

  it("an organisation is a lower-case slug of at most 80 characters, or nothing", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary-ascii", maxLength: 90 }), (value) => {
        const { organisation } = parseBusinessFiltersFromSearchParams(
          new URLSearchParams({ org: value })
        );
        if (organisation !== undefined) {
          expect(organisation).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
          expect(organisation.length).toBeLessThanOrEqual(80);
        }
      }),
      { numRuns: 500 }
    );
  });
});

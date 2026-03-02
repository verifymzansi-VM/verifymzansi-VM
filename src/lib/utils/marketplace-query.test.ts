import { describe, expect, it } from "vitest";
import {
  normalizeMarketplaceCategoryParam,
  normalizeMarketplaceQueryParam,
  parseMarketplaceFiltersFromSearchParams,
} from "./marketplace-query";

describe("marketplace query normalization", () => {
  it("parses canonical category + query", () => {
    const params = new URLSearchParams("category=vehicles&q=iphone");
    expect(parseMarketplaceFiltersFromSearchParams(params)).toEqual({
      category: "vehicles",
      query: "iphone",
    });
  });

  it("maps legacy cars alias to vehicles", () => {
    expect(normalizeMarketplaceCategoryParam("cars")).toBe("vehicles");
  });

  it("maps legacy jobs alias to jobs_services", () => {
    expect(normalizeMarketplaceCategoryParam("jobs")).toBe("jobs_services");
  });

  it("trims query text", () => {
    expect(normalizeMarketplaceQueryParam("  tv  ")).toBe("tv");
  });

  it("returns undefined for invalid category", () => {
    expect(normalizeMarketplaceCategoryParam("not_real")).toBeUndefined();
  });

  it("returns undefined for blank query", () => {
    expect(normalizeMarketplaceQueryParam("   ")).toBeUndefined();
  });
});

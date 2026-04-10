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
      province: undefined,
      city: undefined,
      condition: undefined,
      sort: undefined,
      priceMin: undefined,
      priceMax: undefined,
      page: 1,
      attributes: {},
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

  it("accepts new farming and baby categories", () => {
    expect(normalizeMarketplaceCategoryParam("farming_agriculture")).toBe("farming_agriculture");
    expect(normalizeMarketplaceCategoryParam("baby_kids")).toBe("baby_kids");
  });

  it("parses checklist-style attr filters as arrays", () => {
    const params = new URLSearchParams(
      "category=vehicles&attr_extras=sunroof,towbar&attr_service_history=full"
    );

    expect(parseMarketplaceFiltersFromSearchParams(params)).toEqual({
      category: "vehicles",
      query: undefined,
      province: undefined,
      city: undefined,
      condition: undefined,
      sort: undefined,
      priceMin: undefined,
      priceMax: undefined,
      page: 1,
      attributes: {
        extras: ["sunroof", "towbar"],
        service_history: "full",
      },
    });
  });

  it("returns undefined for blank query", () => {
    expect(normalizeMarketplaceQueryParam("   ")).toBeUndefined();
  });
});

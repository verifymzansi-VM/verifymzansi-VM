import { describe, expect, it } from "vitest";
import {
  getPromotionFilterTypeFromStoredType,
  getStoredPromotionTypeForFilter,
  getStoredPromotionTypesForFilter,
  parsePromotionFilterType,
} from "./type-taxonomy";

describe("promotion type taxonomy", () => {
  it("normalizes legacy product and service filters into Promotions", () => {
    expect(parsePromotionFilterType("product")).toBe("promotion");
    expect(parsePromotionFilterType("service")).toBe("promotion");
    expect(getStoredPromotionTypesForFilter("promotion")).toEqual(["product", "service"]);
  });

  it("normalizes general into Ads", () => {
    expect(parsePromotionFilterType("general")).toBe("ad");
    expect(getStoredPromotionTypesForFilter("ad")).toEqual(["general"]);
  });

  it("maps stored service records back to the Promotions bucket", () => {
    expect(getPromotionFilterTypeFromStoredType("service")).toBe("promotion");
    expect(getStoredPromotionTypeForFilter("promotion", "service")).toBe("service");
    expect(getStoredPromotionTypeForFilter("promotion", "general")).toBe("product");
  });
});

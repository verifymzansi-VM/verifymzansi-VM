import { describe, it, expect } from "vitest";
import {
  getPromotionFilterTypePresentation,
  getStoredPromotionTypePresentation,
  ALL_PROMOTION_TYPE_PRESENTATION,
  PROMOTION_FILTER_TYPE_PRESENTATIONS,
} from "@/lib/promotions/type-presentation";

describe("getPromotionFilterTypePresentation", () => {
  it("returns ALL_PROMOTION_TYPE_PRESENTATION when value is undefined", () => {
    expect(getPromotionFilterTypePresentation(undefined)).toBe(ALL_PROMOTION_TYPE_PRESENTATION);
  });

  it("returns event presentation when value is 'event'", () => {
    const result = getPromotionFilterTypePresentation("event");
    expect(result).toBe(PROMOTION_FILTER_TYPE_PRESENTATIONS["event"]);
    expect(result.cardTagLabel).toBe("Event");
  });
});

describe("getStoredPromotionTypePresentation", () => {
  it("returns event presentation for stored type 'event'", () => {
    const result = getStoredPromotionTypePresentation("event");
    expect(result).toBe(PROMOTION_FILTER_TYPE_PRESENTATIONS["event"]);
  });

  it("returns event presentation for stored type 'deal' (always maps to event)", () => {
    const result = getStoredPromotionTypePresentation("deal");
    expect(result).toBe(PROMOTION_FILTER_TYPE_PRESENTATIONS["event"]);
  });
});

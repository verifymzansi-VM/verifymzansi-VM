import { describe, expect, it } from "vitest";
import {
  getPromotionFilterTypeFromStoredType,
  getStoredPromotionTypeForFilter,
  getStoredPromotionTypesForFilter,
  parsePromotionFilterType,
} from "./type-taxonomy";

describe("promotion type taxonomy", () => {
  it("maps all legacy filter types to event for backward compat", () => {
    expect(parsePromotionFilterType("product")).toBe("event");
    expect(parsePromotionFilterType("service")).toBe("event");
    expect(parsePromotionFilterType("deal")).toBe("event");
    expect(parsePromotionFilterType("general")).toBe("event");
    expect(parsePromotionFilterType("ad")).toBe("event");
    expect(parsePromotionFilterType("promotion")).toBe("event");
  });

  it("parses event filter type", () => {
    expect(parsePromotionFilterType("event")).toBe("event");
  });

  it("returns null for unknown filter types", () => {
    expect(parsePromotionFilterType("unknown")).toBeNull();
    expect(parsePromotionFilterType(null)).toBeNull();
    expect(parsePromotionFilterType(undefined)).toBeNull();
  });

  it("always returns event for stored type mapping", () => {
    expect(getPromotionFilterTypeFromStoredType("service")).toBe("event");
    expect(getPromotionFilterTypeFromStoredType("deal")).toBe("event");
    expect(getPromotionFilterTypeFromStoredType("event")).toBe("event");
    expect(getPromotionFilterTypeFromStoredType("general")).toBe("event");
  });

  it("always returns event for stored promotion types", () => {
    expect(getStoredPromotionTypesForFilter("event")).toEqual(["event"]);
    expect(getStoredPromotionTypeForFilter("event")).toBe("event");
  });
});

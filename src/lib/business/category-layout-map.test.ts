import { describe, it, expect } from "vitest";
import {
  CATEGORY_LAYOUT_MAP,
  CATEGORY_CTA_CONFIG,
  resolveBusinessLayout,
} from "./category-layout-map";
import type { BusinessCategory } from "@/types/enums";

describe("CATEGORY_LAYOUT_MAP", () => {
  it("maps all 12 categories", () => {
    expect(Object.keys(CATEGORY_LAYOUT_MAP)).toHaveLength(12);
  });

  it("assigns cinematic to visual categories", () => {
    expect(CATEGORY_LAYOUT_MAP.fashion_accessories).toBe("cinematic");
    expect(CATEGORY_LAYOUT_MAP.health_beauty).toBe("cinematic");
    expect(CATEGORY_LAYOUT_MAP.food_dining).toBe("cinematic");
    expect(CATEGORY_LAYOUT_MAP.events_entertainment).toBe("cinematic");
  });

  it("assigns showcase to product categories", () => {
    expect(CATEGORY_LAYOUT_MAP.electronics_tech).toBe("showcase");
    expect(CATEGORY_LAYOUT_MAP.groceries_essentials).toBe("showcase");
    expect(CATEGORY_LAYOUT_MAP.home_living).toBe("showcase");
    expect(CATEGORY_LAYOUT_MAP.automotive_transport).toBe("showcase");
  });

  it("assigns professional to service categories", () => {
    expect(CATEGORY_LAYOUT_MAP.trade_maintenance).toBe("professional");
    expect(CATEGORY_LAYOUT_MAP.professional_services).toBe("professional");
    expect(CATEGORY_LAYOUT_MAP.education_training).toBe("professional");
    expect(CATEGORY_LAYOUT_MAP.general_other).toBe("professional");
  });
});

describe("CATEGORY_CTA_CONFIG", () => {
  it("provides servicesHeading and galleryHeading for every category", () => {
    const categories = Object.keys(CATEGORY_LAYOUT_MAP) as BusinessCategory[];
    for (const cat of categories) {
      const cfg = CATEGORY_CTA_CONFIG[cat];
      expect(cfg.servicesHeading).toBeTruthy();
      expect(cfg.galleryHeading).toBeTruthy();
    }
  });
});

describe("resolveBusinessLayout", () => {
  it("returns explicit layout when set to cinematic", () => {
    expect(resolveBusinessLayout("cinematic", "general_other")).toBe("cinematic");
  });

  it("returns explicit layout when set to showcase", () => {
    expect(resolveBusinessLayout("showcase", "fashion_accessories")).toBe("showcase");
  });

  it("returns explicit layout when set to professional", () => {
    expect(resolveBusinessLayout("professional", "food_dining")).toBe("professional");
  });

  it("falls back to category default when layout is null", () => {
    expect(resolveBusinessLayout(null, "fashion_accessories")).toBe("cinematic");
    expect(resolveBusinessLayout(null, "electronics_tech")).toBe("showcase");
    expect(resolveBusinessLayout(null, "trade_maintenance")).toBe("professional");
  });

  it("falls back to category default when layout is undefined", () => {
    expect(resolveBusinessLayout(undefined, "food_dining")).toBe("cinematic");
  });

  it("falls back to professional for unknown category", () => {
    expect(resolveBusinessLayout(null, "unknown_category")).toBe("professional");
  });

  it("ignores invalid layout string and uses category default", () => {
    expect(resolveBusinessLayout("invalid", "events_entertainment")).toBe("cinematic");
  });
});

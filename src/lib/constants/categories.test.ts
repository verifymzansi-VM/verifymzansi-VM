import { describe, it, expect } from "vitest";
import { CATEGORIES, getCategory, isValidCategoryForArea } from "./categories";
import type { ListingCategory } from "@/types/enums";

describe("categories", () => {
  it("exports 8 categories", () => {
    expect(CATEGORIES).toHaveLength(8);
  });

  it("every category has required fields", () => {
    for (const cat of CATEGORIES) {
      expect(cat.value).toBeTruthy();
      expect(cat.label).toBeTruthy();
      expect(cat.icon).toBeDefined();
      expect(cat.description).toBeTruthy();
      expect(Array.isArray(cat.attributeFields)).toBe(true);
    }
  });

  it("category values match expected set", () => {
    const values = CATEGORIES.map((c) => c.value);
    expect(values).toContain("property");
    expect(values).toContain("vehicles");
    expect(values).toContain("auto_parts");
    expect(values).toContain("electronics");
    expect(values).toContain("home_lifestyle");
    expect(values).toContain("jobs_services");
    expect(values).toContain("farming_agriculture");
    expect(values).toContain("baby_kids");
  });

  it("every attribute field has required props", () => {
    for (const cat of CATEGORIES) {
      for (const field of cat.attributeFields) {
        expect(field.name).toBeTruthy();
        expect(field.label).toBeTruthy();
        expect(["text", "number", "select", "boolean", "checklist"]).toContain(field.type);
        expect(typeof field.required).toBe("boolean");
      }
    }
  });

  it("select fields have options array", () => {
    for (const cat of CATEGORIES) {
      for (const field of cat.attributeFields) {
        if (field.type === "select") {
          expect(Array.isArray(field.options)).toBe(true);
          if (field.dependsOn) {
            // Models depend on Make and start empty
            expect(field.options!.length).toBeGreaterThanOrEqual(0);
          } else {
            expect(field.options!.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  describe("getCategory", () => {
    it("returns correct category for valid value", () => {
      const property = getCategory("property" as ListingCategory);
      expect(property).toBeDefined();
      expect(property!.label).toBe("Property (For Sale & To Rent)");
    });

    it("returns undefined for invalid value", () => {
      const result = getCategory("nonexistent" as ListingCategory);
      expect(result).toBeUndefined();
    });

    it("property category has expected attribute fields", () => {
      const property = getCategory("property" as ListingCategory);
      const fieldNames = property!.attributeFields.map((f) => f.name);
      expect(fieldNames).toContain("property_type");
      expect(fieldNames).toContain("bedrooms");
      expect(fieldNames).toContain("bathrooms");
    });

    it("vehicles category has make/model/year required", () => {
      const cars = getCategory("vehicles" as ListingCategory);
      const requiredFields = cars!.attributeFields.filter((f) => f.required).map((f) => f.name);
      expect(requiredFields).toContain("make");
      expect(requiredFields).toContain("model");
      expect(requiredFields).toContain("year");
    });
  });

  describe("isValidCategoryForArea", () => {
    it("accepts listing categories for Mzansi Market", () => {
      expect(isValidCategoryForArea("MZANSI_MARKET", "vehicles")).toBe(true);
      expect(isValidCategoryForArea("MZANSI_MARKET", "property")).toBe(true);
    });

    it("rejects non-listing categories for Mzansi Market", () => {
      expect(isValidCategoryForArea("MZANSI_MARKET", "fashion_accessories")).toBe(false);
      expect(isValidCategoryForArea("MZANSI_MARKET", "not_a_category")).toBe(false);
    });

    it("accepts business categories for Mzansi Business", () => {
      expect(isValidCategoryForArea("MZANSI_BUSINESS", "fashion_accessories")).toBe(true);
      expect(isValidCategoryForArea("MZANSI_BUSINESS", "general_other")).toBe(true);
    });

    it("rejects non-business categories for Mzansi Business", () => {
      expect(isValidCategoryForArea("MZANSI_BUSINESS", "vehicles")).toBe(false);
      // tourism_hospitality is routed to Tourism & Events, not Mzansi Business.
      expect(isValidCategoryForArea("MZANSI_BUSINESS", "tourism_hospitality")).toBe(false);
    });

    it("accepts any non-empty free-text category for Tourism & Events", () => {
      expect(isValidCategoryForArea("PROMOTIONS_EVENTS", "Weekend special")).toBe(true);
    });

    it("rejects empty or missing categories", () => {
      expect(isValidCategoryForArea("MZANSI_MARKET", "")).toBe(false);
      expect(isValidCategoryForArea("MZANSI_MARKET", null)).toBe(false);
      expect(isValidCategoryForArea("MZANSI_BUSINESS", undefined)).toBe(false);
      expect(isValidCategoryForArea("PROMOTIONS_EVENTS", "   ")).toBe(false);
    });
  });
});

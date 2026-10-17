import { describe, it, expect } from "vitest";
import {
  parseListingAttributes,
  parseListingAttributeDraft,
  clearInactiveListingAttributes,
  parseAttributeMoney,
  validateAttributeRegistry,
} from "./attributes";
import reference from "./reference.json";
describe("versioned listing attribute rules", () => {
  it("preserves optional common condition separately from parts/equipment choices and excludes jobs", () => {
    const fixtures: Record<string, Record<string, unknown>> = {
      property: { property_type: "house", listing_intent: "sale" },
      vehicles: {
        make: "Toyota",
        model: "Corolla",
        year: 2020,
        mileage_km: 1,
        transmission: "manual",
        fuel_type: "petrol",
        service_history: "none",
      },
      auto_parts: { part_type: "Brake", part_condition: "used" },
      electronics: { device_type: "Smartphone", brand: "Fixture" },
      home_lifestyle: { sub_category: "furniture" },
      clothing_accessories: {},
      sports_hobbies: {},
      other_items: {},
      farming_agriculture: { farm_category: "equipment_machinery", equipment_condition: "used" },
      baby_kids: { item_type: "toys" },
    };
    const choices = ["new", "like_new", "good", "fair", "for_parts"];
    for (const [category, base] of Object.entries(fixtures)) {
      expect(parseListingAttributes(category, base)).toEqual(base);
      for (const condition of choices)
        expect(parseListingAttributes(category, { ...base, condition })).toEqual({
          ...base,
          condition,
        });
      for (const condition of [null, "used", "refurbished", "Good", " good "])
        expect(() => parseListingAttributes(category, { ...base, condition })).toThrow();
    }
    expect(
      parseListingAttributes("auto_parts", {
        part_type: "Brake",
        part_condition: "used",
        condition: "for_parts",
      })
    ).toEqual({ part_type: "Brake", part_condition: "used", condition: "for_parts" });
    expect(() =>
      parseListingAttributes("jobs_services", {
        job_type: "part_time",
        location_type: "remote",
        condition: "good",
      })
    ).toThrow();
    expect(
      clearInactiveListingAttributes("jobs_services", {
        condition: "good",
        job_type: "part_time",
        location_type: "remote",
      })
    ).toEqual({ job_type: "part_time", location_type: "remote" });
  });
  it("rejects weakening/duplicate/cyclic field registry data", () => {
    const field = reference.listingFields[0];
    expect(() => validateAttributeRegistry([field, field])).toThrow();
    expect(() =>
      validateAttributeRegistry([{ ...field, validation: { type: "string", minimum: 1 } }])
    ).toThrow();
    expect(() =>
      validateAttributeRegistry([
        { ...field, validation: { type: "integer", minimum: 2, maximum: 1 } },
      ])
    ).toThrow();
    expect(() =>
      validateAttributeRegistry([{ ...field, dynamicMaximum: "caller_provided" }])
    ).toThrow();
    expect(() => validateAttributeRegistry([{ ...field, dependsOn: field.key }])).toThrow();
    expect(() => validateAttributeRegistry([{ ...field, owner_authority: true }])).toThrow();
  });
  it.each([
    "clothing",
    "baby_kids",
    "sports_outdoor",
    "musical_instruments",
    "books_stationery",
    "other",
  ])("rejects retired home subtype %s", (sub_category) => {
    expect(() => parseListingAttributes("home_lifestyle", { sub_category })).toThrow();
  });
  it("distinguishes custom owner text suggestions from closed category choices", () => {
    expect(
      parseListingAttributes("auto_parts", {
        part_type: "Custom restored part",
        part_condition: "used",
      }).part_type
    ).toBe("Custom restored part");
    expect(() =>
      parseListingAttributes("auto_parts", {
        part_type: "Custom restored part",
        part_condition: "custom",
      })
    ).toThrow();
  });
  it("rejects inactive farm data and clears it before a command", () => {
    const old = {
      farm_category: "equipment_machinery",
      livestock_type: "cattle",
      breed: "Brahman",
      equipment_condition: "used",
      quantity: 1,
    };
    expect(() => parseListingAttributes("farming_agriculture", old)).toThrow();
    const cleared = clearInactiveListingAttributes("farming_agriculture", old);
    expect(cleared).not.toHaveProperty("livestock_type");
    expect(cleared).not.toHaveProperty("breed");
    expect(parseListingAttributes("farming_agriculture", cleared)).toEqual(cleared);
  });
  it("preserves explicit false assertions, validates real dates and retires duplicate monetary fields", () => {
    const property = {
      property_type: "house",
      listing_intent: "rent",
      pets_allowed: false,
      levy_cents: 29,
      rates_taxes_cents: 0,
      available_from: "2028-02-29",
    };
    expect(parseListingAttributes("property", property)).toEqual(property);
    for (const patch of [
      { monthly_rent_zar: 100 },
      { levy_cents: 1.5 },
      { rates_taxes_cents: 100000000001 },
      { available_from: "2027-02-29" },
      { available_from: "0000-01-01" },
    ])
      expect(() => parseListingAttributes("property", { ...property, ...patch })).toThrow();
  });
  it("enforces choice/length/duplicate limits and rejects arbitrary authority", () => {
    const property = {
      property_type: "house",
      listing_intent: "sale",
      security_features: ["alarm"],
    };
    expect(parseListingAttributes("property", property)).toEqual(property);
    for (const patch of [
      { security_features: ["invented"] },
      { security_features: ["alarm", "alarm"] },
      { bedrooms: 21 },
      { owner_id: "foreign" },
      { published_at: "now" },
    ])
      expect(() => parseListingAttributes("property", { ...property, ...patch })).toThrow();
  });
  it("uses South African new-year boundary for model years", () => {
    const vehicle = {
      make: "Toyota",
      model: "Corolla",
      year: 2027,
      mileage_km: 1,
      transmission: "manual",
      fuel_type: "petrol",
      service_history: "none",
    };
    expect(() =>
      parseListingAttributes("vehicles", vehicle, new Date("2025-12-31T21:59:59Z"))
    ).toThrow();
    expect(parseListingAttributes("vehicles", vehicle, new Date("2025-12-31T22:00:00Z"))).toEqual(
      vehicle
    );
  });
  it("requires typed attributes and category-specific cleanup", () => {
    expect(() => parseListingAttributes("invented", {})).toThrow();
    expect(() =>
      parseListingAttributes("electronics", { device_type: "Smartphone", brand: "  " })
    ).toThrow();
    expect(
      clearInactiveListingAttributes("clothing_accessories", {
        brand: "Example",
        power_rating: "200W",
        salary_min: 10,
      })
    ).toEqual({ brand: "Example" });
  });
  it.each([
    ["0", 0],
    ["0.29", 29],
    ["1000000000.00", 100000000000],
  ])("parses exact ancillary money %s", (text, cents) =>
    expect(parseAttributeMoney(String(text))).toBe(cents)
  );
  it.each(["1e3", "1.001", "-1", "1000000000.01"])("rejects unsafe ancillary money %s", (text) =>
    expect(() => parseAttributeMoney(text)).toThrow()
  );
});

describe("incomplete listing attribute drafts", () => {
  it("permits missing required fields only in draft validation", () => {
    expect(parseListingAttributeDraft("electronics", {})).toEqual({});
    expect(() => parseListingAttributes("electronics", {})).toThrow();
  });
  it("still rejects invalid, unknown and inactive fields", () => {
    for (const attrs of [
      { unknown: "private" },
      { device_type: "invented" },
      { storage_gb: "128" },
    ])
      expect(() => parseListingAttributeDraft("electronics", attrs)).toThrow();
  });
  it("uses the same current field normalization for valid partial data", () => {
    expect(parseListingAttributeDraft("electronics", { brand: "  Samsung  " })).toEqual({
      brand: "Samsung",
    });
  });
  it("matches SQL UTF16 lengths at the astral-character boundary", () => {
    const symbol = String.fromCodePoint(0x1f600);
    expect(parseListingAttributeDraft("electronics", { brand: symbol.repeat(40) }).brand).toBe(
      symbol.repeat(40)
    );
    expect(() => parseListingAttributeDraft("electronics", { brand: symbol.repeat(41) })).toThrow();
  });
});

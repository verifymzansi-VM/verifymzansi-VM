import { describe, expect, it } from "vitest";

import { sanitizeCategoryDetails } from "./business-category-details";

describe("sanitizeCategoryDetails", () => {
  it("keeps configured fields with the right type and drops the rest", () => {
    const out = sanitizeCategoryDetails("tourism_hospitality", {
      amenities: "wifi", // a string where the page maps over a list
      accommodation_types: ["guesthouse", 42, "  bnb  "],
      star_rating: "<script>",
      number_of_rooms: 12,
      pets_allowed: "yes",
      booking_url: "javascript:alert(1)",
      unknown_key: { nested: true },
      subcategory: "guesthouse",
    });
    expect(out).toEqual({
      accommodation_types: ["guesthouse", "bnb"],
      number_of_rooms: 12,
      subcategory: "guesthouse",
    });
  });

  it("caps long text and lists", () => {
    const out = sanitizeCategoryDetails("food_dining", {
      dietary_options: Array.from({ length: 100 }, (_, i) => `option ${i}`),
    });
    expect((out.dietary_options as string[]).length).toBeLessThanOrEqual(30);
  });

  it("keeps the app's own keys", () => {
    const out = sanitizeCategoryDetails("food_dining", {
      customer_access: { version: 2, methods: ["visit"], publishAddress: true },
      contact_methods: ["call"],
      venue_photos: ["https://media.verifymzansi.com/a.jpg"],
    });
    expect(out).toMatchObject({
      customer_access: { version: 2 },
      contact_methods: ["call"],
      venue_photos: ["https://media.verifymzansi.com/a.jpg"],
    });
  });
  it("keeps the newer tourism keys with their fixed choices and whole numbers", () => {
    const out = sanitizeCategoryDetails("tourism_hospitality", {
      price_from_cents: 45000.4,
      price_unit: "night",
      sleeps: 4,
      bedrooms: "2",
      beds: 3,
      bathrooms: 1,
      backup_utilities: ["inverter_solar", "Water tanks", "solar_panels", "generator", "generator"],
      cancellation_policy: "free_until_days",
      cancellation_free_days: 7,
      opening_hours: "Daily 08:00 to 17:00",
    });
    expect(out).toEqual({
      price_from_cents: 45000,
      price_unit: "night",
      sleeps: 4,
      bedrooms: 2,
      beds: 3,
      bathrooms: 1,
      backup_utilities: ["inverter_solar", "water_tanks", "generator"],
      cancellation_policy: "free_until_days",
      cancellation_free_days: 7,
      opening_hours: "Daily 08:00 to 17:00",
    });
  });

  it("refuses unknown tourism choices and caps opening hours at 120 characters", () => {
    const out = sanitizeCategoryDetails("tourism_hospitality", {
      price_unit: "week",
      cancellation_policy: "maybe",
      sleeps: 0,
      opening_hours: "x".repeat(200),
    });
    expect(out).toEqual({ opening_hours: "x".repeat(120) });
  });

  it("still keeps the older tourism values so old posts stay readable", () => {
    const out = sanitizeCategoryDetails("tourism_hospitality", {
      price_range: "midrange",
      cancellation_policy: "moderate",
      star_rating: 4,
    });
    expect(out).toEqual({
      price_range: "midrange",
      cancellation_policy: "moderate",
      star_rating: 4,
    });
  });

  it("keeps a tourism From price over R10 000, and drops a unit without a price", () => {
    expect(
      sanitizeCategoryDetails("tourism_hospitality", {
        price_from_cents: 1_500_000,
        price_unit: "night",
        sleeps: 4,
      })
    ).toEqual({ price_from_cents: 1_500_000, price_unit: "night", sleeps: 4 });
    // Above R1 000 000 the price is refused, and its unit goes with it.
    expect(
      sanitizeCategoryDetails("tourism_hospitality", {
        price_from_cents: 100_000_001,
        price_unit: "night",
        sleeps: 4,
      })
    ).toEqual({ sleeps: 4 });
    // Other number fields keep their own limit.
    expect(sanitizeCategoryDetails("tourism_hospitality", { number_of_rooms: 2_000_000 })).toEqual(
      {}
    );
  });
});

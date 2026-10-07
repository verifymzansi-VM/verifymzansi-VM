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
});

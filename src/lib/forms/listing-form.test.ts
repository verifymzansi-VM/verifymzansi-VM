import { describe, expect, it } from "vitest";
import { coerceListingAttributes, validateListingAttributes } from "./listing-form";

describe("listing-form helpers", () => {
  it("coerces numeric and boolean category attributes into schema-safe values", () => {
    expect(
      coerceListingAttributes("property", {
        bedrooms: "3",
        bathrooms: "2",
        furnished: true,
        pets_allowed: false,
        size_sqm: "120",
      })
    ).toEqual({
      bedrooms: 3,
      bathrooms: 2,
      furnished: true,
      pets_allowed: false,
      size_sqm: 120,
    });
  });

  it("returns attribute-level validation errors for missing required fields", () => {
    expect(validateListingAttributes("electronics", {})).toMatchObject({
      "attributes.brand": expect.stringContaining("expected string"),
    });
  });
});

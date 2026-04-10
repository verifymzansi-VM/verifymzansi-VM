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
        floor_size_sqm: "120",
      })
    ).toEqual({
      bedrooms: 3,
      bathrooms: 2,
      furnished: true,
      pets_allowed: false,
      floor_size_sqm: 120,
    });
  });

  it("returns attribute-level validation errors for missing required fields", () => {
    expect(validateListingAttributes("electronics", {})).toMatchObject({
      "attributes.device_type": expect.stringContaining("Invalid option"),
      "attributes.brand": expect.stringContaining("expected string"),
    });
  });

  it("keeps supported electronics text attributes during coercion", () => {
    expect(
      coerceListingAttributes("electronics", {
        device_type: "Gaming Console",
        brand: "Sony",
        model_name: "PlayStation 5",
      })
    ).toEqual({
      device_type: "Gaming Console",
      brand: "Sony",
      model_name: "PlayStation 5",
    });
  });

  it("maps legacy jobs remote=true to location_type=remote", () => {
    expect(
      coerceListingAttributes("jobs_services", {
        job_type: "full_time",
        remote: true,
      })
    ).toEqual({
      job_type: "full_time",
      location_type: "remote",
    });
  });
});

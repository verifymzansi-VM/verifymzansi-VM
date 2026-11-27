import { describe, expect, it } from "vitest";
import { fieldLabelFor, lookupFieldPath, plainFieldMessage } from "./field-paths";

describe("lookupFieldPath", () => {
  it("uses the full path first, then the nearest prefix", () => {
    const map = { service_areas: 1, "category_details.customer_access": 2, category_details: 0 };
    expect(lookupFieldPath("service_areas.areas", map)).toBe(1);
    expect(lookupFieldPath("category_details.customer_access.serviceAreas", map)).toBe(2);
    expect(lookupFieldPath("category_details.star_rating", map)).toBe(0);
    expect(lookupFieldPath("title", map)).toBeUndefined();
  });
});

describe("fieldLabelFor", () => {
  it("prefers the form's label, including for a nested path", () => {
    expect(fieldLabelFor("service_areas.areas", { service_areas: "Service areas" })).toBe(
      "Service areas"
    );
  });

  it("turns a raw path into a plain label", () => {
    expect(fieldLabelFor("attributes.property_type")).toBe("Property type");
    expect(fieldLabelFor("service_areas.areas")).toBe("Service areas");
    expect(fieldLabelFor("category_details.customer_access.serviceAreas")).toBe("Service areas");
    expect(fieldLabelFor("gallery_photos.0")).toBe("Gallery photos");
  });
});

describe("plainFieldMessage", () => {
  it("keeps a usable limit in plain words", () => {
    expect(plainFieldMessage("Too small: expected string to have >=5 characters")).toBe(
      "Must be at least 5 characters"
    );
    expect(plainFieldMessage("Too big: expected string to have <=100 characters")).toBe(
      "Must be at most 100 characters"
    );
    expect(plainFieldMessage("Too small: expected number to be >=0")).toBe("Must be at least 0");
    expect(plainFieldMessage("Too big: expected number to be <=20")).toBe("Must be at most 20");
    expect(plainFieldMessage("Too small: expected array to have >=1 items")).toBe(
      "Must be at least 1 item"
    );
  });

  it("words exclusive limits as more or less than", () => {
    expect(plainFieldMessage("Too small: expected number to be >0")).toBe("Must be more than 0");
    expect(plainFieldMessage("Too big: expected number to be <100")).toBe("Must be less than 100");
    expect(plainFieldMessage("Too small: expected string to have >1 characters")).toBe(
      "Must be more than 1 character"
    );
  });

  it("replaces other raw schema text", () => {
    expect(plainFieldMessage('Invalid option: expected one of "house"|"apartment"')).toBe(
      "Choose one of the options."
    );
    expect(plainFieldMessage("Invalid input: expected string, received undefined")).toBe(
      "Check this field."
    );
  });

  it("passes custom messages through, even ones that start like built-in text", () => {
    expect(plainFieldMessage("Expected true or false")).toBe("Expected true or false");
    expect(plainFieldMessage("Required fields are missing")).toBe("Required fields are missing");
    expect(plainFieldMessage("Invalid input for the registered office")).toBe(
      "Invalid input for the registered office"
    );
  });

  it("leaves written messages alone", () => {
    expect(plainFieldMessage("Add at least one service area.")).toBe(
      "Add at least one service area."
    );
  });
});

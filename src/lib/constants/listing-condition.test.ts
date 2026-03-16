import { describe, it, expect } from "vitest";
import { getListingConditionLabel, LISTING_CONDITIONS } from "./listing-condition";

describe("listing-condition", () => {
  it("LISTING_CONDITIONS contains entries", () => {
    expect(LISTING_CONDITIONS.length).toBeGreaterThan(0);
    expect(LISTING_CONDITIONS[0]).toHaveProperty("value");
    expect(LISTING_CONDITIONS[0]).toHaveProperty("label");
  });

  it("getListingConditionLabel returns label for known condition", () => {
    const cond = LISTING_CONDITIONS[0];
    expect(getListingConditionLabel(cond.value)).toBe(cond.label);
  });

  it("getListingConditionLabel returns undefined for null", () => {
    expect(getListingConditionLabel(null)).toBeUndefined();
    expect(getListingConditionLabel(undefined)).toBeUndefined();
  });

  it("getListingConditionLabel falls back to formatted string for unknown", () => {
    expect(getListingConditionLabel("some_unknown_value")).toBe("some unknown value");
  });
});

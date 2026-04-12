import { describe, it, expect } from "vitest";
import { getVehicleMakeNames, getModelsForMake } from "@/lib/constants/sa-vehicles";

describe("getVehicleMakeNames", () => {
  it("returns a non-empty array of make names", () => {
    const names = getVehicleMakeNames();
    expect(names.length).toBeGreaterThan(0);
    expect(typeof names[0]).toBe("string");
  });
});

describe("getModelsForMake", () => {
  it("returns models for a known make", () => {
    const makes = getVehicleMakeNames();
    const firstMake = makes[0];
    const models = getModelsForMake(firstMake);
    expect(Array.isArray(models)).toBe(true);
  });

  it("returns empty array for an unknown make", () => {
    const models = getModelsForMake("UNKNOWN_MAKE_XYZ");
    expect(models).toEqual([]);
  });
});

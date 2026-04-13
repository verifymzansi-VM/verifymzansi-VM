import { describe, expect, it } from "vitest";
import { getTownsForCity } from "@/lib/constants/sa-towns";

describe("getTownsForCity", () => {
  it("returns towns for a known province and city", () => {
    const towns = getTownsForCity("Gauteng", "Johannesburg");

    expect(towns.length).toBeGreaterThan(0);
    expect(towns).toContain("Braamfontein");
  });

  it("returns an empty array for an unknown city", () => {
    expect(getTownsForCity("Gauteng", "Unknown City")).toEqual([]);
  });

  it("returns an empty array for an unknown province", () => {
    expect(getTownsForCity("Unknown Province", "Johannesburg")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { buildListingFacts } from "./listing-facts";

describe("buildListingFacts", () => {
  it("shows measured values as the seller typed them", () => {
    const facts = buildListingFacts({
      category: "electronics",
      attributes: { screen_size_inches: 6.68, warranty_months: 1, battery_health_pct: 100 },
    });
    const value = (label: string) => facts.find((fact) => fact.label === label)?.value;
    expect(value("Screen Size")).toBe("6.68 in");
    expect(value("Warranty")).toBe("1 month");
    expect(value("Battery Health")).toBe("100%");
  });
});

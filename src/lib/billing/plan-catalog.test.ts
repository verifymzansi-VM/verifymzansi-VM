import { describe, expect, it } from "vitest";
import { getCanonicalActivePlanDefinition, validateCanonicalPaidPlan } from "./plan-catalog";

describe("billing plan catalog validation", () => {
  it("recognizes Mzansi Market Basic as an active canonical package", () => {
    const plan = getCanonicalActivePlanDefinition("MZANSI_MARKET", "basic");

    expect(plan?.name).toBe("Mzansi Market Basic");
    expect(plan?.priceCents).toBe(3000);
  });

  it("accepts a database row that matches the runtime package catalog", () => {
    expect(
      validateCanonicalPaidPlan({
        id: "basic-plan",
        area: "MZANSI_MARKET",
        tier: "basic",
        price_cents: 3000,
        active: true,
      })
    ).toBeNull();
  });

  it("rejects inactive, legacy, or price-drifted plan rows", () => {
    expect(
      validateCanonicalPaidPlan({
        id: "inactive",
        area: "MZANSI_MARKET",
        tier: "basic",
        price_cents: 3000,
        active: false,
      })
    ).toContain("inactive");

    expect(
      validateCanonicalPaidPlan({
        id: "legacy",
        area: "MALL_SHOPS",
        tier: "starter",
        price_cents: 20000,
        active: true,
      })
    ).toContain("active package catalog");

    expect(
      validateCanonicalPaidPlan({
        id: "drifted",
        area: "MZANSI_MARKET",
        tier: "basic",
        price_cents: 1,
        active: true,
      })
    ).toContain("price");
  });
});

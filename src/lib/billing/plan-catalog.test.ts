import { describe, expect, it } from "vitest";
import { validateCanonicalPaidPlan } from "./plan-catalog";

describe("billing plan catalog validation", () => {
  it("accepts active retail and bulk rows at their database price", () => {
    expect(
      validateCanonicalPaidPlan({
        id: "retail",
        area: "MZANSI_MARKET",
        tier: "half_year",
        price_cents: 25000,
        active: true,
      })
    ).toBeNull();
    // Admins may change prices in Commercial Settings; the DB row is authoritative.
    expect(
      validateCanonicalPaidPlan({
        id: "retail-repriced",
        area: "MZANSI_MARKET",
        tier: "month",
        price_cents: 4500,
        active: true,
      })
    ).toBeNull();
    expect(
      validateCanonicalPaidPlan({
        id: "bulk",
        area: null,
        tier: "enterprise",
        price_cents: 500000,
        active: true,
      })
    ).toBeNull();
  });

  it("rejects inactive, legacy, unpriced or area-less retail rows", () => {
    expect(
      validateCanonicalPaidPlan({
        id: "inactive",
        area: "MZANSI_MARKET",
        tier: "month",
        price_cents: 5000,
        active: false,
      })
    ).toContain("inactive");
    expect(
      validateCanonicalPaidPlan({
        id: "legacy",
        area: "MZANSI_MARKET",
        tier: "basic",
        price_cents: 3000,
        active: true,
      })
    ).toContain("active package catalog");
    expect(
      validateCanonicalPaidPlan({
        id: "flagged-legacy",
        area: "MZANSI_MARKET",
        tier: "month",
        price_cents: 5000,
        active: true,
        is_legacy: true,
      })
    ).toContain("active package catalog");
    expect(
      validateCanonicalPaidPlan({
        id: "free",
        area: "MZANSI_MARKET",
        tier: "month",
        price_cents: 0,
        active: true,
      })
    ).toContain("price");
    expect(
      validateCanonicalPaidPlan({
        id: "no-area",
        area: null,
        tier: "month",
        price_cents: 5000,
        active: true,
      })
    ).toContain("area");
  });
});

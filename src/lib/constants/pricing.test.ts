import { describe, expect, it } from "vitest";
import {
  PLANS,
  LEGACY_PLANS,
  RETAIL_OFFERS,
  ENTERPRISE_PLANS,
  ADDON_PRICES,
  TRIAL_CONFIG,
  FREE_POST_CONFIG,
  PAID_POST_CONFIG,
  ACTIVE_MARKETPLACE_AREAS,
  formatDurationDays,
  getPlansForArea,
  getPlan,
  getRetailSavingsCents,
  isLegacyPlanTier,
  type PlanDefinition,
} from "./pricing";

describe("retail pricing ladder", () => {
  it("sells R50 / 30 days, R250 / 6 months and R450 / 12 months", () => {
    expect(RETAIL_OFFERS.map((o) => [o.tier, o.priceCents, o.durationDays])).toEqual([
      ["month", 5000, 30],
      ["half_year", 25000, 180],
      ["year", 45000, 365],
    ]);
  });

  it("labels 6 months Most popular and 12 months Best value, with the savings", () => {
    const [month, half, year] = RETAIL_OFFERS;
    expect(month?.promoLabel).toBe("Flexible");
    expect(half?.promoLabel).toBe("Most popular");
    expect(year?.promoLabel).toBe("Best value");
    expect(getRetailSavingsCents(half!)).toBe(5000);
    expect(getRetailSavingsCents(year!)).toBe(15000);
    expect(getRetailSavingsCents(month!)).toBe(0);
  });

  it("defines one retail plan per area and duration, each with one reusable slot", () => {
    expect(PLANS).toHaveLength(9);
    for (const area of ACTIVE_MARKETPLACE_AREAS) {
      expect(getPlansForArea(area).map((p) => p.tier)).toEqual(["month", "half_year", "year"]);
    }
    for (const plan of PLANS) {
      expect(plan.slotCapacity).toBe(1);
      expect(plan.billingFrequency).toBe("fixed_term");
      expect(plan.legacy).toBeUndefined();
    }
  });

  it("keeps old tiers only as legacy definitions", () => {
    expect(LEGACY_PLANS.every((p) => p.legacy && isLegacyPlanTier(p.tier))).toBe(true);
    expect(PLANS.some((p) => isLegacyPlanTier(p.tier))).toBe(false);
    expect(
      LEGACY_PLANS.find((p) => p.area === "MZANSI_MARKET" && p.tier === "basic")?.priceCents
    ).toBe(3000);
  });

  it("prices bulk slots and leaves 1,000+ to custom quotes", () => {
    expect(ENTERPRISE_PLANS).toHaveLength(12);
    expect(ENTERPRISE_PLANS.find((p) => p.planCode === "ENT_50_3M")?.priceCents).toBe(500000);
    expect(ENTERPRISE_PLANS.find((p) => p.planCode === "ENT_500_12M")?.priceCents).toBe(10000000);
    expect(ENTERPRISE_PLANS.some((p) => p.slots >= 1000)).toBe(false);
  });

  it("formats durations", () => {
    expect(formatDurationDays(30)).toBe("30 days");
    expect(formatDurationDays(180)).toBe("6 months");
    expect(formatDurationDays(365)).toBe("12 months");
  });
});

describe("pricing constants", () => {
  it("covers exactly the three marketplace areas", () => {
    const areas = Array.from(new Set(PLANS.map((p) => p.area)));
    expect(areas).toHaveLength(3);
  });

  it("defines addon prices", () => {
    expect(ADDON_PRICES.boost).toBeGreaterThan(0);
    expect(ADDON_PRICES.featured).toBeGreaterThan(0);
    expect(ADDON_PRICES.urgent).toBeGreaterThan(0);
  });

  it("defines trial config", () => {
    expect(TRIAL_CONFIG.durationDays).toBe(30);
    expect(TRIAL_CONFIG.maxListings).toBeGreaterThan(0);
  });

  it("defines free post config", () => {
    expect(FREE_POST_CONFIG.durationDays).toBe(7);
    expect(FREE_POST_CONFIG.maxPhotos).toBe(10);
    expect(FREE_POST_CONFIG.maxVideos).toBe(1);
    expect(FREE_POST_CONFIG.videoAllowed).toBe(true);
    expect(FREE_POST_CONFIG.maxAllowed).toBe(1);
  });

  it("defines paid post visibility config", () => {
    expect(PAID_POST_CONFIG.durationDays).toBe(30);
  });
});

describe("getPlan", () => {
  it("finds retail and legacy plans", () => {
    expect(getPlan("MZANSI_BUSINESS", "half_year")?.priceCents).toBe(25000);
    const legacy = getPlan("MZANSI_BUSINESS", "growth");
    expect(legacy?.legacy).toBe(true);
    expect(legacy?.priceCents).toBe(40000);
  });

  it("returns undefined for bulk tiers, which are not per-area plans", () => {
    expect(getPlan("MZANSI_MARKET", "enterprise")).toBeUndefined();
  });

  it("returns plans only for the requested area", () => {
    const plans = getPlansForArea("MZANSI_MARKET");
    expect(plans.every((p: PlanDefinition) => p.area === "MZANSI_MARKET")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  PLANS,
  ADDON_PRICES,
  PAY_PER_POST,
  TRIAL_CONFIG,
  FREE_POST_CONFIG,
  getPlansForArea,
  getPlan,
  type PlanDefinition,
} from "./pricing";

describe("pricing constants", () => {
  it("defines exactly 13 plans (basic + 4 areas × 3 tiers)", () => {
    expect(PLANS).toHaveLength(13);
  });

  it("covers all four marketplace areas", () => {
    const areas = Array.from(new Set(PLANS.map((p) => p.area)));
    expect(areas).toContain("MZANSI_MARKET");
    expect(areas).toContain("MZANSI_BUSINESS");
    expect(areas).toContain("MALL_SHOPS");
    expect(areas).toContain("BUSINESS_ADS");
  });

  it("covers all three tiers per area", () => {
    for (const area of ["MZANSI_MARKET", "MZANSI_BUSINESS", "MALL_SHOPS", "BUSINESS_ADS"]) {
      const tiers = PLANS.filter((p) => p.area === area).map((p) => p.tier);
      expect(tiers).toContain("starter");
      expect(tiers).toContain("growth");
      expect(tiers).toContain("pro");
    }
  });

  it("all plans have positive price in cents", () => {
    for (const plan of PLANS) {
      expect(plan.priceCents).toBeGreaterThan(0);
    }
  });

  it("pro plans are the most expensive per area", () => {
    for (const area of ["MZANSI_MARKET", "MZANSI_BUSINESS", "MALL_SHOPS", "BUSINESS_ADS"]) {
      const areaPlans = PLANS.filter((p) => p.area === area);
      const pro = areaPlans.find((p) => p.tier === "pro")!;
      const starter = areaPlans.find((p) => p.tier === "starter")!;
      expect(pro.priceCents).toBeGreaterThan(starter.priceCents);
    }
  });

  it("all plans have billing frequency 30_days", () => {
    for (const plan of PLANS) {
      expect(plan.billingFrequency).toBe("30_days");
    }
  });

  it("defines addon prices", () => {
    expect(ADDON_PRICES.boost).toBeGreaterThan(0);
    expect(ADDON_PRICES.featured).toBeGreaterThan(0);
    expect(ADDON_PRICES.urgent).toBeGreaterThan(0);
  });

  it("defines pay-per-post prices", () => {
    expect(PAY_PER_POST["14_days"]).toBeGreaterThan(0);
    expect(PAY_PER_POST["30_days"]).toBeGreaterThan(PAY_PER_POST["14_days"]);
  });

  it("defines trial config", () => {
    expect(TRIAL_CONFIG.durationDays).toBe(30);
    expect(TRIAL_CONFIG.tier).toBe("starter");
    expect(TRIAL_CONFIG.maxListings).toBeGreaterThan(0);
  });

  it("defines free post config", () => {
    expect(FREE_POST_CONFIG.durationDays).toBe(30);
    expect(FREE_POST_CONFIG.maxPhotos).toBe(5);
    expect(FREE_POST_CONFIG.maxVideos).toBe(1);
    expect(FREE_POST_CONFIG.videoAllowed).toBe(true);
    expect(FREE_POST_CONFIG.maxAllowed).toBe(1);
  });
});

describe("getPlansForArea", () => {
  it("returns correct number of plans for each area", () => {
    expect(getPlansForArea("MZANSI_MARKET")).toHaveLength(4);
    expect(getPlansForArea("MZANSI_BUSINESS")).toHaveLength(3);
    expect(getPlansForArea("MALL_SHOPS")).toHaveLength(3);
    expect(getPlansForArea("BUSINESS_ADS")).toHaveLength(3);
  });

  it("returns plans only for the requested area", () => {
    const plans = getPlansForArea("MZANSI_MARKET");
    expect(plans.every((p: PlanDefinition) => p.area === "MZANSI_MARKET")).toBe(true);
  });
});

describe("getPlan", () => {
  it("finds a specific plan", () => {
    const plan = getPlan("MALL_SHOPS", "growth");
    expect(plan).toBeDefined();
    expect(plan?.name).toBe("Mall Shops Growth");
    expect(plan?.priceCents).toBe(50000);
  });

  it("returns undefined for non-existent combo", () => {
    // @ts-expect-error testing invalid
    expect(getPlan("MZANSI_MARKET", "enterprise")).toBeUndefined();
  });
});

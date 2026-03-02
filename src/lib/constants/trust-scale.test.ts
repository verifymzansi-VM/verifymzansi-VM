import { describe, expect, it } from "vitest";
import { TRUST_TIERS, computeTrustLevel, getTrustTier } from "./trust-scale";

describe("TRUST_TIERS", () => {
  it("defines 5 trust levels (0-4)", () => {
    expect(Object.keys(TRUST_TIERS)).toHaveLength(5);
    for (let i = 0; i <= 4; i++) {
      expect(TRUST_TIERS[i as 0 | 1 | 2 | 3 | 4]).toBeDefined();
    }
  });

  it("each tier has required fields", () => {
    for (const tier of Object.values(TRUST_TIERS)) {
      expect(tier.label).toBeTruthy();
      expect(tier.description).toBeTruthy();
      expect(tier.badgeClass).toBeTruthy();
      expect(tier.iconName).toBeTruthy();
    }
  });
});

describe("computeTrustLevel", () => {
  it("returns 0 for null verification status", () => {
    expect(computeTrustLevel(null)).toBe(0);
  });

  it("returns 1 for incomplete verification", () => {
    expect(computeTrustLevel("incomplete")).toBe(1);
  });

  it("returns 2 for pending review", () => {
    expect(computeTrustLevel("pending_review")).toBe(2);
  });

  it("returns 3 for verified without pro plan", () => {
    expect(computeTrustLevel("verified")).toBe(3);
    expect(computeTrustLevel("verified", "starter")).toBe(3);
    expect(computeTrustLevel("verified", "growth")).toBe(3);
  });

  it("returns 4 for verified with pro plan", () => {
    expect(computeTrustLevel("verified", "pro")).toBe(4);
  });

  it("returns 0 for unknown status", () => {
    // @ts-expect-error testing unknown status
    expect(computeTrustLevel("unknown")).toBe(0);
  });

  // Account penalty tests
  it("returns 0 for banned account regardless of verification", () => {
    expect(computeTrustLevel("verified", "pro", "banned")).toBe(0);
    expect(computeTrustLevel("verified", null, "banned")).toBe(0);
    expect(computeTrustLevel("pending_review", null, "banned")).toBe(0);
  });

  it("caps at 1 for suspended account", () => {
    expect(computeTrustLevel("verified", "pro", "suspended")).toBe(1);
    expect(computeTrustLevel("verified", null, "suspended")).toBe(1);
    expect(computeTrustLevel("pending_review", null, "suspended")).toBe(1);
    expect(computeTrustLevel("incomplete", null, "suspended")).toBe(1);
  });

  it("caps at 1 when legal hold is active", () => {
    expect(computeTrustLevel("verified", "pro", "active", { legalHold: true })).toBe(1);
    expect(computeTrustLevel("verified", null, null, { legalHold: true })).toBe(1);
  });

  it("caps at 1 when strikes >= 3", () => {
    expect(computeTrustLevel("verified", "pro", "active", { strikes: 3 })).toBe(1);
    expect(computeTrustLevel("verified", null, "active", { strikes: 5 })).toBe(1);
  });

  it("does not cap for < 3 strikes with active account", () => {
    expect(computeTrustLevel("verified", "pro", "active", { strikes: 2 })).toBe(4);
    expect(computeTrustLevel("verified", null, "active", { strikes: 0 })).toBe(3);
  });

  it("returns normal levels for active account with no penalties", () => {
    expect(computeTrustLevel("verified", "pro", "active")).toBe(4);
    expect(computeTrustLevel("verified", null, "active")).toBe(3);
    expect(computeTrustLevel("pending_review", null, "active")).toBe(2);
  });
});

describe("getTrustTier", () => {
  it("returns correct tier for each level", () => {
    expect(getTrustTier(0).label).toBe("Unregistered");
    expect(getTrustTier(3).label).toBe("Verified");
    expect(getTrustTier(4).label).toBe("Verified Pro");
  });
});

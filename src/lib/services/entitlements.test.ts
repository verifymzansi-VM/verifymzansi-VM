import { describe, expect, it } from "vitest";
import { getEntitlements, canCreateListing, getPlan } from "./entitlements";

describe("entitlements service", () => {
  describe("getPlan", () => {
    it("finds existing plan by tier and area", () => {
      const plan = getPlan("starter", "MZANSI_MARKET");
      expect(plan).toBeDefined();
      expect(plan?.name).toBe("Mzansi Market Starter (legacy)");
    });

    it("returns undefined for bulk tiers, which are not per-area plans", () => {
      expect(getPlan("enterprise", "MZANSI_MARKET")).toBeUndefined();
    });

    it("finds retail plans", () => {
      expect(getPlan("year", "MZANSI_MARKET")?.priceCents).toBe(45000);
    });
  });

  describe("getEntitlements", () => {
    it("returns starter tier entitlements", () => {
      const ent = getEntitlements("starter", "MZANSI_MARKET");
      expect(ent.maxAllowed).toBe(3);
      expect(ent.videoAllowed).toBe(true);
    });

    it("returns Basic tier entitlements for Mzansi Market", () => {
      const ent = getEntitlements("basic", "MZANSI_MARKET");
      expect(ent.maxAllowed).toBe(1);
      expect(ent.videoAllowed).toBe(false);
    });

    it("returns pro tier entitlements capped at 27 listings", () => {
      const ent = getEntitlements("pro", "MZANSI_MARKET");
      expect(ent.maxAllowed).toBe(27);
      expect(ent.videoAllowed).toBe(true);
    });

    it("gives bulk and programme slots the standard photo allowance", () => {
      const ent = getEntitlements("enterprise", "MZANSI_MARKET");
      expect(ent.maxPhotos).toBe(10);
    });

    it("gives retail plans one slot", () => {
      const ent = getEntitlements("half_year", "MZANSI_BUSINESS");
      expect(ent.maxAllowed).toBe(1);
      expect(ent.maxVideos).toBe(1);
    });

    it("works for all three marketplace areas", () => {
      expect(getEntitlements("growth", "MZANSI_BUSINESS").maxAllowed).toBe(3);
      expect(getEntitlements("starter", "PROMOTIONS_EVENTS").maxAllowed).toBe(1);
    });
  });

  describe("canCreateListing", () => {
    it("allows when under limit", () => {
      const result = canCreateListing(2, "starter", "MZANSI_MARKET");
      expect(result.allowed).toBe(true);
    });

    it("blocks when at limit", () => {
      const result = canCreateListing(3, "starter", "MZANSI_MARKET");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("All 3 active posting slots");
    });

    it("allows for pro under limit", () => {
      const result = canCreateListing(20, "pro", "MZANSI_MARKET");
      expect(result.allowed).toBe(true);
    });

    it("blocks for pro at limit", () => {
      const result = canCreateListing(27, "pro", "MZANSI_MARKET");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("All 27 active posting slots");
    });
  });
});

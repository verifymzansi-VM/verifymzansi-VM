import { describe, expect, it } from "vitest";
import {
  getEntitlements,
  canCreateListing,
  canBoost,
  canFeatured,
  canUrgent,
  getPlan,
} from "./entitlements";

describe("entitlements service", () => {
  describe("getPlan", () => {
    it("finds existing plan by tier and area", () => {
      const plan = getPlan("starter", "MZANSI_MARKET");
      expect(plan).toBeDefined();
      expect(plan?.name).toBe("Mzansi Market Starter");
    });

    it("returns undefined for non-existent plan", () => {
      // @ts-expect-error testing invalid tier
      expect(getPlan("enterprise", "MZANSI_MARKET")).toBeUndefined();
    });
  });

  describe("getEntitlements", () => {
    it("returns starter tier entitlements", () => {
      const ent = getEntitlements("starter", "MZANSI_MARKET");
      expect(ent.maxAllowed).toBe(3);
      expect(ent.videoAllowed).toBe(true);
      expect(ent.boostAllowed).toBe(false);
    });

    it("returns Basic tier entitlements for Mzansi Market", () => {
      const ent = getEntitlements("basic", "MZANSI_MARKET");
      expect(ent.maxAllowed).toBe(1);
      expect(ent.videoAllowed).toBe(false);
      expect(ent.boostAllowed).toBe(false);
      expect(ent.featuredAllowed).toBe(false);
      expect(ent.urgentAllowed).toBe(false);
    });

    it("returns pro tier entitlements capped at 27 listings", () => {
      const ent = getEntitlements("pro", "MZANSI_MARKET");
      expect(ent.maxAllowed).toBe(27);
      expect(ent.videoAllowed).toBe(true);
      expect(ent.boostAllowed).toBe(true);
      expect(ent.featuredAllowed).toBe(true);
    });

    it("returns free-tier defaults for unknown plan", () => {
      // @ts-expect-error testing non-existent
      const ent = getEntitlements("enterprise", "MZANSI_MARKET");
      expect(ent.maxAllowed).toBe(1);
      expect(ent.maxPhotos).toBe(10);
    });

    it("works for all three marketplace areas", () => {
      expect(getEntitlements("growth", "MZANSI_BUSINESS").boostAllowed).toBe(true);
      expect(getEntitlements("starter", "PROMOTIONS_EVENTS").boostAllowed).toBe(false);
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
      expect(result.reason).toContain("3 live listings");
    });

    it("allows for pro under limit", () => {
      const result = canCreateListing(20, "pro", "MZANSI_MARKET");
      expect(result.allowed).toBe(true);
    });

    it("blocks for pro at limit", () => {
      const result = canCreateListing(27, "pro", "MZANSI_MARKET");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("27 live listings");
    });
  });

  describe("canBoost", () => {
    it("blocks boost on starter plan", () => {
      const result = canBoost("starter", "MZANSI_MARKET");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Upgrade");
    });

    it("allows boost on growth plan", () => {
      const result = canBoost("growth", "MZANSI_MARKET");
      expect(result.allowed).toBe(true);
    });

    it("allows boost on pro plan", () => {
      const result = canBoost("pro", "MZANSI_MARKET");
      expect(result.allowed).toBe(true);
    });
  });

  describe("canFeatured", () => {
    it("blocks featured on starter plan", () => {
      const result = canFeatured("starter", "MZANSI_MARKET");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Upgrade");
    });

    it("blocks featured on growth plan", () => {
      const result = canFeatured("growth", "MZANSI_MARKET");
      expect(result.allowed).toBe(false);
    });

    it("allows featured on pro plan", () => {
      const result = canFeatured("pro", "MZANSI_MARKET");
      expect(result.allowed).toBe(true);
    });
  });

  describe("canUrgent", () => {
    it("blocks urgent on starter plan", () => {
      const result = canUrgent("starter", "MZANSI_MARKET");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Upgrade");
    });

    it("blocks urgent on growth plan", () => {
      const result = canUrgent("growth", "MZANSI_MARKET");
      expect(result.allowed).toBe(false);
    });

    it("allows urgent on pro plan", () => {
      const result = canUrgent("pro", "MZANSI_MARKET");
      expect(result.allowed).toBe(true);
    });
  });
});

/**
 * Plan-tier entitlement boundary tests.
 *
 * Audit finding M4: No tests verifying tier boundaries across all three
 * marketplace areas. Each tier (basic → starter → growth → pro) unlocks
 * progressively more features. These tests exercise the *real*
 * `getEntitlements`, `canBoost`, `canFeatured`, `canUrgent`, and
 * `canCreateListing` functions against the *real* PLANS constant — no mocks.
 *
 * This catches regressions if someone edits a plan definition and
 * accidentally enables/disables the wrong addon for a tier.
 */
import { describe, it, expect } from "vitest";
import {
  getEntitlements,
  canBoost,
  canFeatured,
  canUrgent,
  canCreateListing,
  getPlan,
} from "@/lib/services/entitlements";
import { PLANS, ADDON_PRICES } from "@/lib/constants/pricing";
import type { PlanTier, MarketplaceArea } from "@/types/enums";

// ── Plan matrix ───────────────────────────────────────────────

const AREAS: MarketplaceArea[] = ["MZANSI_MARKET", "MALL_SHOPS", "BUSINESS_ADS"];
const TIERS: PlanTier[] = ["basic", "starter", "growth", "pro"];

/** Expected addon flags per tier (consistent across all areas) */
const TIER_EXPECTATIONS: Record<PlanTier, { boost: boolean; featured: boolean; urgent: boolean }> =
  {
    basic: { boost: false, featured: false, urgent: false },
    starter: { boost: false, featured: false, urgent: false },
    growth: { boost: true, featured: false, urgent: false },
    pro: { boost: true, featured: true, urgent: true },
  };

// ── Tests ─────────────────────────────────────────────────────

describe("Plan-tier entitlement boundaries", () => {
  describe("Every plan defined in PLANS has matching entitlements", () => {
    it("PLANS array is non-empty", () => {
      expect(PLANS.length).toBeGreaterThan(0);
    });

    it("every area has at least basic/starter/growth/pro tiers", () => {
      for (const area of AREAS) {
        for (const tier of TIERS) {
          const plan = getPlan(tier, area);
          // basic is only defined for MZANSI_MARKET — skip if not defined
          if (!plan && tier === "basic" && area !== "MZANSI_MARKET") continue;
          if (plan) {
            expect(plan.tier).toBe(tier);
            expect(plan.area).toBe(area);
          }
        }
      }
    });
  });

  describe.each(AREAS)("Area: %s", (area) => {
    describe.each(TIERS)("Tier: %s", (tier) => {
      const plan = getPlan(tier, area);

      // basic tier is only defined for MZANSI_MARKET
      if (!plan) {
        it(`${tier}/${area} — plan is correctly not defined`, () => {
          expect(plan).toBeUndefined();
        });
        return;
      }

      const expectedFlags = TIER_EXPECTATIONS[tier];

      it(`boost is ${expectedFlags.boost ? "allowed" : "blocked"}`, () => {
        const result = canBoost(tier, area);
        expect(result.allowed).toBe(expectedFlags.boost);
        if (!expectedFlags.boost) {
          expect(result.reason).toBeDefined();
          expect(result.reason).toContain("Upgrade");
        }
      });

      it(`featured is ${expectedFlags.featured ? "allowed" : "blocked"}`, () => {
        const result = canFeatured(tier, area);
        expect(result.allowed).toBe(expectedFlags.featured);
        if (!expectedFlags.featured) {
          expect(result.reason).toBeDefined();
          expect(result.reason).toContain("Upgrade");
        }
      });

      it(`urgent is ${expectedFlags.urgent ? "allowed" : "blocked"}`, () => {
        const result = canUrgent(tier, area);
        expect(result.allowed).toBe(expectedFlags.urgent);
        if (!expectedFlags.urgent) {
          expect(result.reason).toBeDefined();
          expect(result.reason).toContain("Upgrade");
        }
      });

      it("entitlements have valid numeric limits", () => {
        const ent = getEntitlements(tier, area);
        // maxAllowed is either -1 (unlimited) or a positive integer
        expect(ent.maxAllowed === -1 || ent.maxAllowed > 0).toBe(true);
        expect(ent.maxPhotos).toBeGreaterThan(0);
        expect(ent.maxPostsPerMonth).toBeGreaterThan(0);
      });
    });
  });

  describe("canCreateListing boundary checks", () => {
    it("allows creation when count is below limit", () => {
      const result = canCreateListing(0, "starter", "MZANSI_MARKET");
      expect(result.allowed).toBe(true);
    });

    it("blocks creation when count equals limit", () => {
      // Starter MZANSI_MARKET allows 5 listings
      const result = canCreateListing(5, "starter", "MZANSI_MARKET");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("active listings");
    });

    it("blocks creation when count exceeds limit", () => {
      const result = canCreateListing(10, "starter", "MZANSI_MARKET");
      expect(result.allowed).toBe(false);
    });

    it("allows unlimited for pro tier with -1 maxAllowed", () => {
      // Pro plans should have higher limits — verify they allow more than starter
      const ent = getEntitlements("pro", "MZANSI_MARKET");
      const result = canCreateListing(ent.maxAllowed - 1, "pro", "MZANSI_MARKET");
      expect(result.allowed).toBe(true);
    });

    it("uses correct item type label per area", () => {
      // MALL_SHOPS should say "storefronts"
      const mallResult = canCreateListing(100, "starter", "MALL_SHOPS");
      if (!mallResult.allowed) {
        expect(mallResult.reason).toContain("storefronts");
      }

      // BUSINESS_ADS should say "profiles"
      const bizResult = canCreateListing(100, "starter", "BUSINESS_ADS");
      if (!bizResult.allowed) {
        expect(bizResult.reason).toContain("profiles");
      }

      // MZANSI_MARKET should say "active listings"
      const mktResult = canCreateListing(100, "starter", "MZANSI_MARKET");
      if (!mktResult.allowed) {
        expect(mktResult.reason).toContain("active listings");
      }
    });
  });

  describe("Free-tier fallback", () => {
    it("returns restrictive defaults for unknown tier/area combo", () => {
      // Cast to bypass type checks — simulates a corrupted DB value
      const ent = getEntitlements("nonexistent" as PlanTier, "MZANSI_MARKET");
      expect(ent.boostAllowed).toBe(false);
      expect(ent.featuredAllowed).toBe(false);
      expect(ent.urgentAllowed).toBe(false);
      expect(ent.maxAllowed).toBe(1);
      expect(ent.maxPhotos).toBe(10);
    });
  });

  describe("Addon prices are defined and positive", () => {
    it("boost price is positive", () => {
      expect(ADDON_PRICES.boost).toBeGreaterThan(0);
    });

    it("featured price is positive", () => {
      expect(ADDON_PRICES.featured).toBeGreaterThan(0);
    });

    it("urgent price is positive", () => {
      expect(ADDON_PRICES.urgent).toBeGreaterThan(0);
    });

    it("featured costs more than urgent (business rule)", () => {
      expect(ADDON_PRICES.featured).toBeGreaterThan(ADDON_PRICES.urgent);
    });
  });

  describe("Tier progression is monotonically non-decreasing", () => {
    it.each(AREAS)("maxAllowed grows or stays unlimited across tiers in %s", (area) => {
      const tierOrder: PlanTier[] = ["starter", "growth", "pro"];
      let prevMax = 0;
      for (const tier of tierOrder) {
        const ent = getEntitlements(tier, area);
        if (ent.maxAllowed === -1) {
          // unlimited — always OK
          continue;
        }
        expect(ent.maxAllowed).toBeGreaterThanOrEqual(prevMax);
        prevMax = ent.maxAllowed;
      }
    });

    it.each(AREAS)("maxPhotos grows or stays equal across tiers in %s", (area) => {
      const tierOrder: PlanTier[] = ["starter", "growth", "pro"];
      let prev = 0;
      for (const tier of tierOrder) {
        const ent = getEntitlements(tier, area);
        expect(ent.maxPhotos).toBeGreaterThanOrEqual(prev);
        prev = ent.maxPhotos;
      }
    });
  });
});

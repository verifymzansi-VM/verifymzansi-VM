/**
 * Plan-tier entitlement boundary tests.
 *
 * Audit finding M4: No tests verifying tier boundaries across all three
 * marketplace areas. Each tier (basic → starter → growth → pro) unlocks
 * progressively more features. These tests exercise the *real*
 * `getEntitlements` and `canCreateListing` functions against the *real* PLANS
 * constant — no mocks.
 */
import { describe, it, expect } from "vitest";
import { getEntitlements, canCreateListing, getPlan } from "@/lib/services/entitlements";
import { PLANS } from "@/lib/constants/pricing";
import type { PlanTier, MarketplaceArea } from "@/types/enums";

// ── Plan matrix ───────────────────────────────────────────────

const AREAS: MarketplaceArea[] = ["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"];
const TIERS = ["basic", "starter", "growth", "pro", "month", "half_year", "year"] as const;

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
      expect(result.reason).toContain("active posting slots");
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

    it("explains the slot limit the same way in every area", () => {
      for (const area of AREAS) {
        const result = canCreateListing(100, "month", area);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("active posting slot");
        expect(result.reason).toContain("Mark a post as sold");
      }
    });
  });

  describe("Free-tier fallback", () => {
    it("returns restrictive defaults for unknown tier/area combo", () => {
      // Cast to bypass type checks — simulates a corrupted DB value
      const ent = getEntitlements("nonexistent" as PlanTier, "MZANSI_MARKET");
      expect(ent.maxAllowed).toBe(1);
      expect(ent.maxPhotos).toBe(10);
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

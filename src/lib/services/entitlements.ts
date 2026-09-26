/**
 * Entitlement engine — check what an account holder's plan allows.
 */

import {
  FREE_POST_CONFIG,
  getPlan as getCatalogPlan,
  type PlanDefinition,
} from "@/lib/constants/pricing";
import type { PlanTier, MarketplaceArea } from "@/types/enums";

export interface Entitlements {
  /**
   * Represents the maximum number of items (listings, storefronts, or profiles)
   * allowed for the specific marketplace area.
   */
  maxAllowed: number;
  maxPhotos: number;
  maxVideos: number;
  maxPostsPerMonth: number;
  videoAllowed: boolean;
  boostAllowed: boolean;
  featuredAllowed: boolean;
  urgentAllowed: boolean;
}

const FREE_ENTITLEMENTS: Entitlements = {
  maxAllowed: FREE_POST_CONFIG.maxAllowed,
  maxPhotos: FREE_POST_CONFIG.maxPhotos,
  maxVideos: FREE_POST_CONFIG.maxVideos,
  maxPostsPerMonth: FREE_POST_CONFIG.maxAllowed,
  videoAllowed: FREE_POST_CONFIG.videoAllowed,
  boostAllowed: false,
  featuredAllowed: false,
  urgentAllowed: false,
};

const ENTERPRISE_ENTITLEMENTS: Entitlements = {
  maxAllowed: 1,
  maxPhotos: FREE_POST_CONFIG.maxPhotos,
  maxVideos: 1,
  maxPostsPerMonth: 100,
  videoAllowed: true,
  boostAllowed: true,
  featuredAllowed: true,
  urgentAllowed: true,
};

/**
 * Look up the plan definition for a given tier and marketplace area.
 * @returns The matching {@link PlanDefinition}, or `undefined` if not found.
 */
export function getPlan(tier: PlanTier, area: MarketplaceArea): PlanDefinition | undefined {
  return getCatalogPlan(area, tier);
}

/**
 * Resolve the full entitlement set for a plan tier in a marketplace area.
 * Falls back to free-tier limits when no plan is found.
 */
export function getEntitlements(tier: PlanTier, area: MarketplaceArea): Entitlements {
  // Bulk and programme slots cover every area; capacity comes from the slot
  // allowance (posting_allowance), so only feature flags matter here.
  if (tier === "enterprise") return ENTERPRISE_ENTITLEMENTS;

  const plan = getPlan(tier, area);

  if (!plan) return FREE_ENTITLEMENTS;

  let maxAllowed: number;
  switch (area) {
    case "MZANSI_MARKET":
      maxAllowed = plan.features.maxListings ?? 0;
      break;
    case "MZANSI_BUSINESS":
      maxAllowed = plan.features.maxBusinesses ?? 0;
      break;
    case "PROMOTIONS_EVENTS":
      maxAllowed = plan.features.maxPromotions ?? 0;
      break;
    default: {
      // Exhaustive check — ensures new MarketplaceArea values cause a
      // compile-time error instead of silently granting unlimited access.
      const _exhaustive: never = area;
      throw new Error(`Unknown marketplace area: ${_exhaustive}`);
    }
  }

  return {
    maxAllowed,
    maxPhotos: plan.features.maxPhotos,
    maxVideos: plan.features.maxVideos ?? 0,
    maxPostsPerMonth: plan.features.maxPostsPerMonth,
    videoAllowed: plan.features.videoAllowed,
    boostAllowed: plan.features.boostAllowed,
    featuredAllowed: plan.features.featuredAllowed,
    urgentAllowed: plan.features.urgentAllowed,
  };
}

/**
 * Check whether an account holder can create another listing/storefront/profile.
 * Compares `currentCount` against the plan's limit (`-1` = unlimited).
 */
export function canCreateListing(
  currentCount: number,
  tier: PlanTier,
  area: MarketplaceArea
): { allowed: boolean; reason?: string } {
  const ent = getEntitlements(tier, area);

  // -1 means unlimited
  if (ent.maxAllowed === -1) return { allowed: true };

  if (currentCount >= ent.maxAllowed) {
    return { allowed: false, reason: slotLimitReason(ent.maxAllowed) };
  }

  return { allowed: true };
}

/** Plain-language explanation shown when every active posting slot is in use. */
export function slotLimitReason(capacity: number): string {
  const slots =
    capacity === 1 ? "Your active posting slot is" : `All ${capacity} active posting slots are`;
  return `${slots} in use. Mark a post as sold, deactivate one, or add a slot from R50 / 30 days.`;
}

/**
 * Check whether an account holder's plan allows boosting listings.
 * @returns `{ allowed: true }` or `{ allowed: false, reason }` with upgrade prompt.
 */
export function canBoost(
  tier: PlanTier,
  area: MarketplaceArea
): { allowed: boolean; reason?: string } {
  const ent = getEntitlements(tier, area);

  if (!ent.boostAllowed) {
    return {
      allowed: false,
      reason: "Boost is available on paid plans. Choose a plan from R50 / 30 days to use boosts.",
    };
  }

  return { allowed: true };
}

/**
 * Check whether an account holder's plan allows featuring listings.
 * Available on paid plans (retail and bulk).
 */
export function canFeatured(
  tier: PlanTier,
  area: MarketplaceArea
): { allowed: boolean; reason?: string } {
  const ent = getEntitlements(tier, area);

  if (!ent.featuredAllowed) {
    return {
      allowed: false,
      reason: "Featured placement is available on paid plans. Choose a plan from R50 / 30 days.",
    };
  }

  return { allowed: true };
}

/**
 * Check whether an account holder's plan allows marking listings as urgent.
 * Available on paid plans (retail and bulk).
 */
export function canUrgent(
  tier: PlanTier,
  area: MarketplaceArea
): { allowed: boolean; reason?: string } {
  const ent = getEntitlements(tier, area);

  if (!ent.urgentAllowed) {
    return {
      allowed: false,
      reason: "The urgent badge is available on paid plans. Choose a plan from R50 / 30 days.",
    };
  }

  return { allowed: true };
}

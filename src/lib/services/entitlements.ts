/**
 * Entitlement engine — check what a seller's plan allows.
 */

import { PLANS, type PlanDefinition } from "@/lib/constants/pricing";
import type { PlanTier, MarketplaceArea } from "@/types/enums";

export interface Entitlements {
  /**
   * Represents the maximum number of items (listings, storefronts, or profiles)
   * allowed for the specific marketplace area.
   */
  maxAllowed: number;
  maxPhotos: number;
  maxPostsPerMonth: number;
  videoAllowed: boolean;
  boostAllowed: boolean;
  featuredAllowed: boolean;
  urgentAllowed: boolean;
}

const FREE_ENTITLEMENTS: Entitlements = {
  maxAllowed: 1,
  maxPhotos: 5,
  maxPostsPerMonth: 1,
  videoAllowed: true,
  boostAllowed: false,
  featuredAllowed: false,
  urgentAllowed: false,
};

/**
 * Look up the plan definition for a given tier and marketplace area.
 * @returns The matching {@link PlanDefinition}, or `undefined` if not found.
 */
export function getPlan(tier: PlanTier, area: MarketplaceArea): PlanDefinition | undefined {
  return PLANS.find((p) => p.tier === tier && p.area === area);
}

/**
 * Resolve the full entitlement set for a plan tier in a marketplace area.
 * Falls back to free-tier limits when no plan is found.
 */
export function getEntitlements(tier: PlanTier, area: MarketplaceArea): Entitlements {
  const plan = getPlan(tier, area);

  if (!plan) return FREE_ENTITLEMENTS;

  let maxAllowed = -1;
  if (area === "MZANSI_MARKET") {
    maxAllowed = plan.features.maxListings ?? -1;
  } else if (area === "MZANSI_BUSINESS") {
    maxAllowed = plan.features.maxBusinesses ?? -1;
  } else if (area === "PROMOTIONS_EVENTS") {
    maxAllowed = plan.features.maxPromotions ?? -1;
  } else if (area === "MALL_SHOPS") {
    maxAllowed = plan.features.maxStorefronts ?? -1;
  } else if (area === "BUSINESS_ADS") {
    maxAllowed = plan.features.maxProfiles ?? -1;
  }

  return {
    maxAllowed,
    maxPhotos: plan.features.maxPhotos,
    maxPostsPerMonth: plan.features.maxPostsPerMonth,
    videoAllowed: plan.features.videoAllowed,
    boostAllowed: plan.features.boostAllowed,
    featuredAllowed: plan.features.featuredAllowed,
    urgentAllowed: plan.features.urgentAllowed,
  };
}

/**
 * Check whether a seller can create another listing/storefront/profile.
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
    const itemType =
      area === "MZANSI_BUSINESS"
        ? "businesses"
        : area === "PROMOTIONS_EVENTS"
          ? "promotions"
          : area === "MALL_SHOPS"
            ? "storefronts"
            : area === "BUSINESS_ADS"
              ? "profiles"
              : "active listings";
    return {
      allowed: false,
      reason: `Your ${tier} plan allows up to ${ent.maxAllowed} ${itemType}. Upgrade to post more.`,
    };
  }

  return { allowed: true };
}

/**
 * Check whether a seller's plan allows boosting listings.
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
      reason: "Boost is not available on your plan. Upgrade to use boosts.",
    };
  }

  return { allowed: true };
}

/**
 * Check whether a seller's plan allows featuring listings.
 * Only available on Pro plans.
 */
export function canFeatured(
  tier: PlanTier,
  area: MarketplaceArea
): { allowed: boolean; reason?: string } {
  const ent = getEntitlements(tier, area);

  if (!ent.featuredAllowed) {
    return {
      allowed: false,
      reason: "Featured is only available on the Pro plan. Upgrade to feature your listings.",
    };
  }

  return { allowed: true };
}

/**
 * Check whether a seller's plan allows marking listings as urgent.
 * Only available on Pro plans.
 */
export function canUrgent(
  tier: PlanTier,
  area: MarketplaceArea
): { allowed: boolean; reason?: string } {
  const ent = getEntitlements(tier, area);

  if (!ent.urgentAllowed) {
    return {
      allowed: false,
      reason: "Urgent is only available on the Pro plan. Upgrade to mark listings as urgent.",
    };
  }

  return { allowed: true };
}

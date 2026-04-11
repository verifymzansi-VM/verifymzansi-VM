import type { MarketplaceArea, PlanTier } from "@/types/enums";
import { getStablePlanId } from "@/lib/constants/plan-ids";

export const ACTIVE_MARKETPLACE_AREAS = [
  "MZANSI_MARKET",
  "MZANSI_BUSINESS",
  "PROMOTIONS_EVENTS",
] as const satisfies readonly MarketplaceArea[];

/**
 * Legacy marketplace areas that have been replaced by MZANSI_BUSINESS.
 * These are kept for backward compatibility with existing database records
 * but should not be used for new subscriptions.
 */
export const LEGACY_MARKETPLACE_AREAS: readonly MarketplaceArea[] = [
  "MALL_SHOPS",
  "BUSINESS_ADS",
] as const;

/**
 * Returns the canonical replacement for a legacy marketplace area.
 * Returns the original area if it is not deprecated.
 */
export function getCanonicalArea(area: MarketplaceArea): MarketplaceArea {
  if (area === "MALL_SHOPS" || area === "BUSINESS_ADS") {
    return "MZANSI_BUSINESS";
  }
  return area;
}

/**
 * Returns true if the area is a legacy (deprecated) marketplace area.
 */
export function isLegacyArea(area: MarketplaceArea): boolean {
  return (LEGACY_MARKETPLACE_AREAS as readonly string[]).includes(area);
}

export function isActiveMarketplaceArea(area: MarketplaceArea): boolean {
  return (ACTIVE_MARKETPLACE_AREAS as readonly MarketplaceArea[]).includes(area);
}

/* ── Plan Definitions ────────────────────────────────────── */
export interface PlanDefinition {
  area: MarketplaceArea;
  tier: PlanTier;
  name: string;
  priceCents: number;
  billingFrequency: "30_days";
  features: {
    maxListings?: number;
    maxPhotos: number;
    maxStorefronts?: number;
    maxProfiles?: number;
    maxBusinesses?: number;
    maxPromotions?: number;
    maxPostsPerMonth: number;
    videoAllowed: boolean;
    maxVideos?: number;
    boostAllowed: boolean;
    featuredAllowed: boolean;
    urgentAllowed: boolean;
    coverVideoAllowed: boolean;
  };
}

export interface PlanFeatureItem {
  text: string;
  included: boolean;
}

export const PLANS: PlanDefinition[] = [
  // Mzansi Market
  {
    area: "MZANSI_MARKET",
    tier: "basic",
    name: "Mzansi Market Basic",
    priceCents: 3000,
    billingFrequency: "30_days",
    features: {
      maxListings: 1,
      maxPhotos: 10,
      maxPostsPerMonth: 1,
      videoAllowed: false,
      boostAllowed: false,
      featuredAllowed: false,
      urgentAllowed: false,
      coverVideoAllowed: false,
    },
  },
  {
    area: "MZANSI_MARKET",
    tier: "starter",
    name: "Mzansi Market Starter",
    priceCents: 10000,
    billingFrequency: "30_days",
    features: {
      maxListings: 3,
      maxPhotos: 10,
      maxPostsPerMonth: 5,
      videoAllowed: true,
      maxVideos: 1,
      boostAllowed: false,
      featuredAllowed: false,
      urgentAllowed: false,
      coverVideoAllowed: false,
    },
  },
  {
    area: "MZANSI_MARKET",
    tier: "growth",
    name: "Mzansi Market Growth",
    priceCents: 25000,
    billingFrequency: "30_days",
    features: {
      maxListings: 9,
      maxPhotos: 10,
      maxPostsPerMonth: 15,
      videoAllowed: true,
      maxVideos: 3,
      boostAllowed: true,
      featuredAllowed: false,
      urgentAllowed: false,
      coverVideoAllowed: false,
    },
  },
  {
    area: "MZANSI_MARKET",
    tier: "pro",
    name: "Mzansi Market Pro",
    priceCents: 65000,
    billingFrequency: "30_days",
    features: {
      maxListings: 27, // 3x growth (9 * 3)
      maxPhotos: 10,
      maxPostsPerMonth: 45, // 3x growth (15 * 3)
      videoAllowed: true,
      maxVideos: 9,
      boostAllowed: true,
      featuredAllowed: true,
      urgentAllowed: true,
      coverVideoAllowed: false,
    },
  },
  // Mzansi Business (unified — replaces Mall Shops + Business Ads)
  {
    area: "MZANSI_BUSINESS",
    tier: "starter",
    name: "Mzansi Business Starter",
    priceCents: 15000,
    billingFrequency: "30_days",
    features: {
      maxBusinesses: 1,
      maxPhotos: 10,
      maxPostsPerMonth: 5,
      videoAllowed: true,
      maxVideos: 1,
      boostAllowed: false,
      featuredAllowed: false,
      urgentAllowed: false,
      coverVideoAllowed: false,
    },
  },
  {
    area: "MZANSI_BUSINESS",
    tier: "growth",
    name: "Mzansi Business Growth",
    priceCents: 40000,
    billingFrequency: "30_days",
    features: {
      maxBusinesses: 3,
      maxPhotos: 10,
      maxPostsPerMonth: 15,
      videoAllowed: true,
      maxVideos: 3,
      boostAllowed: true,
      featuredAllowed: false,
      urgentAllowed: false,
      coverVideoAllowed: true,
    },
  },
  {
    area: "MZANSI_BUSINESS",
    tier: "pro",
    name: "Mzansi Business Pro",
    priceCents: 100000,
    billingFrequency: "30_days",
    features: {
      maxBusinesses: 9,
      maxPhotos: 10,
      maxPostsPerMonth: 45,
      videoAllowed: true,
      maxVideos: 9,
      boostAllowed: true,
      featuredAllowed: true,
      urgentAllowed: true,
      coverVideoAllowed: true,
    },
  },
  // Tourism & Events
  {
    area: "PROMOTIONS_EVENTS",
    tier: "starter",
    name: "Promotions Starter",
    priceCents: 15000,
    billingFrequency: "30_days",
    features: {
      maxPromotions: 1,
      maxPhotos: 10,
      maxPostsPerMonth: 5,
      videoAllowed: true,
      maxVideos: 1,
      boostAllowed: false,
      featuredAllowed: false,
      urgentAllowed: false,
      coverVideoAllowed: false,
    },
  },
  {
    area: "PROMOTIONS_EVENTS",
    tier: "growth",
    name: "Promotions Growth",
    priceCents: 40000,
    billingFrequency: "30_days",
    features: {
      maxPromotions: 3,
      maxPhotos: 10,
      maxPostsPerMonth: 15,
      videoAllowed: true,
      maxVideos: 3,
      boostAllowed: true,
      featuredAllowed: false,
      urgentAllowed: false,
      coverVideoAllowed: false,
    },
  },
  {
    area: "PROMOTIONS_EVENTS",
    tier: "pro",
    name: "Promotions Pro",
    priceCents: 100000,
    billingFrequency: "30_days",
    features: {
      maxPromotions: 9,
      maxPhotos: 10,
      maxPostsPerMonth: 45,
      videoAllowed: true,
      maxVideos: 9,
      boostAllowed: true,
      featuredAllowed: true,
      urgentAllowed: true,
      coverVideoAllowed: false,
    },
  },
  /**
   * @deprecated Use MZANSI_BUSINESS plans instead.
   * Kept for backward compatibility with existing database subscriptions.
   * Do NOT create new subscriptions with MALL_SHOPS — use MZANSI_BUSINESS.
   */
  {
    area: "MALL_SHOPS",
    tier: "starter",
    name: "Mall Shops Starter",
    priceCents: 20000,
    billingFrequency: "30_days",
    features: {
      maxStorefronts: 1,
      maxPhotos: 10,
      maxPostsPerMonth: 5,
      videoAllowed: true,
      maxVideos: 1,
      boostAllowed: false,
      featuredAllowed: false,
      urgentAllowed: false,
      coverVideoAllowed: false,
    },
  },
  {
    area: "MALL_SHOPS",
    tier: "growth",
    name: "Mall Shops Growth",
    priceCents: 50000,
    billingFrequency: "30_days",
    features: {
      maxStorefronts: 3,
      maxPhotos: 10,
      maxPostsPerMonth: 15,
      videoAllowed: true,
      maxVideos: 3,
      boostAllowed: true,
      featuredAllowed: false,
      urgentAllowed: false,
      coverVideoAllowed: true,
    },
  },
  {
    area: "MALL_SHOPS",
    tier: "pro",
    name: "Mall Shops Pro",
    priceCents: 120000,
    billingFrequency: "30_days",
    features: {
      maxStorefronts: 9, // 3x growth (3 * 3)
      maxPhotos: 10,
      maxPostsPerMonth: 45, // 3x growth (15 * 3)
      videoAllowed: true,
      maxVideos: 9,
      boostAllowed: true,
      featuredAllowed: true,
      urgentAllowed: true,
      coverVideoAllowed: true,
    },
  },
  /**
   * @deprecated Use MZANSI_BUSINESS plans instead.
   * Kept for backward compatibility with existing database subscriptions.
   * Do NOT create new subscriptions with BUSINESS_ADS — use MZANSI_BUSINESS.
   */
  {
    area: "BUSINESS_ADS",
    tier: "starter",
    name: "Business Ads Starter",
    priceCents: 15000,
    billingFrequency: "30_days",
    features: {
      maxProfiles: 1,
      maxPhotos: 10,
      maxPostsPerMonth: 5,
      videoAllowed: true,
      maxVideos: 1,
      boostAllowed: false,
      featuredAllowed: false,
      urgentAllowed: false,
      coverVideoAllowed: false,
    },
  },
  {
    area: "BUSINESS_ADS",
    tier: "growth",
    name: "Business Ads Growth",
    priceCents: 40000,
    billingFrequency: "30_days",
    features: {
      maxProfiles: 3,
      maxPhotos: 10,
      maxPostsPerMonth: 15,
      videoAllowed: true,
      maxVideos: 3,
      boostAllowed: true,
      featuredAllowed: false,
      urgentAllowed: false,
      coverVideoAllowed: true,
    },
  },
  {
    area: "BUSINESS_ADS",
    tier: "pro",
    name: "Business Ads Pro",
    priceCents: 100000,
    billingFrequency: "30_days",
    features: {
      maxProfiles: 9, // 3x growth (3 * 3)
      maxPhotos: 10,
      maxPostsPerMonth: 45, // 3x growth (15 * 3)
      videoAllowed: true,
      maxVideos: 9,
      boostAllowed: true,
      featuredAllowed: true,
      urgentAllowed: true,
      coverVideoAllowed: true,
    },
  },
];

/* ── Add-on Prices (cents) ───────────────────────────────── */
export const ADDON_PRICES = {
  boost: 1500,
  featured: 2500,
  urgent: 1000,
} as const;

/** How many days a single boost lasts */
export const BOOST_DURATION_DAYS = 7;

/** How many days a single featured add-on lasts */
export const FEATURED_DURATION_DAYS = 7;

/** How many days a single urgent add-on lasts */
export const URGENT_DURATION_DAYS = 7;

/* ── Pay-per-post (Mzansi Market only, cents) ────────────── */
export const PAY_PER_POST = {
  "14_days": 2000,
  "30_days": 3000,
} as const;

/**
 * @deprecated Use FREE_POST_CONFIG instead.
 * Kept for backward compatibility — existing code that references
 * TRIAL_CONFIG.tier or TRIAL_CONFIG.durationDays still works.
 */
export const TRIAL_CONFIG = {
  durationDays: 30,
  tier: "starter" as PlanTier,
  maxListings: 1,
} as const;

/* ── Free Post Config ────────────────────────────────────── */
/**
 * Free posts per marketplace area.
 * Each account gets up to 2 free posts in each area.
 * Free posts expire after the configured duration.
 */
export const FREE_POST_CONFIG = {
  durationDays: 7,
  maxPhotos: 10,
  maxVideos: 1,
  videoAllowed: true,
  maxAllowed: 2, // 2 posts per area
} as const;

export function formatPlanPrice(priceCents: number): string {
  return `R${(priceCents / 100).toLocaleString("en-ZA")}`;
}

export function getPlanCheckoutId(plan: Pick<PlanDefinition, "area" | "tier">): string {
  return getStablePlanId(plan.area, plan.tier);
}

export function getPlanCheckoutHref(plan: Pick<PlanDefinition, "area" | "tier">): string {
  return `/billing/checkout?plan=${getPlanCheckoutId(plan)}`;
}

export function getPlanFeatureItems(
  plan: PlanDefinition,
  options?: { includeDisabled?: boolean }
): PlanFeatureItem[] {
  const features = plan.features;
  const includeDisabled = options?.includeDisabled ?? false;
  const items: PlanFeatureItem[] = [];

  const push = (text: string, included = true) => {
    if (included || includeDisabled) {
      items.push({ text, included });
    }
  };

  if (features.maxListings !== undefined) push(`Up to ${features.maxListings} listings`);
  if (features.maxStorefronts !== undefined) push(`${features.maxStorefronts} storefronts`);
  if (features.maxProfiles !== undefined) push(`${features.maxProfiles} profiles`);
  if (features.maxBusinesses !== undefined) {
    push(`${features.maxBusinesses} business${features.maxBusinesses === 1 ? "" : "es"}`);
  }
  if (features.maxPromotions !== undefined) push(`${features.maxPromotions} promotions`);

  push(`${features.maxPhotos} photos per post`);
  push(
    features.maxVideos !== undefined
      ? `${features.maxVideos} video tour${features.maxVideos === 1 ? "" : "s"}`
      : "Video uploads",
    features.videoAllowed
  );
  push("Boost listings", features.boostAllowed);
  push("Featured placement", features.featuredAllowed);
  push("Urgent badge", features.urgentAllowed);
  push("Cover video", features.coverVideoAllowed);

  return items;
}

export function getActivePlans(): PlanDefinition[] {
  return PLANS.filter((plan) => isActiveMarketplaceArea(plan.area));
}

export function getActivePlansByArea() {
  const activePlans = getActivePlans();

  return {
    activePlans,
    marketPlans: activePlans.filter((plan) => plan.area === "MZANSI_MARKET"),
    businessPlans: activePlans.filter((plan) => plan.area === "MZANSI_BUSINESS"),
    promotionPlans: activePlans.filter((plan) => plan.area === "PROMOTIONS_EVENTS"),
  };
}

/**
 * Get plans for a specific marketplace area.
 */
export function getPlansForArea(area: MarketplaceArea): PlanDefinition[] {
  return PLANS.filter((p) => p.area === area);
}

/**
 * Get a specific plan.
 */
export function getPlan(area: MarketplaceArea, tier: PlanTier): PlanDefinition | undefined {
  return PLANS.find((p) => p.area === area && p.tier === tier);
}

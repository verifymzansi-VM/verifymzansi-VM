import type { MarketplaceArea, PlanTier, RetailPlanTier } from "@/types/enums";
import { getStablePlanId } from "@/lib/constants/plan-ids";

export const ACTIVE_MARKETPLACE_AREAS = [
  "MZANSI_MARKET",
  "MZANSI_BUSINESS",
  "PROMOTIONS_EVENTS",
] as const satisfies readonly MarketplaceArea[];

export function isActiveMarketplaceArea(area: MarketplaceArea): boolean {
  return (ACTIVE_MARKETPLACE_AREAS as readonly MarketplaceArea[]).includes(area);
}

/* ── Plan Definitions ────────────────────────────────────── */
/**
 * Plan catalogue defaults. The `plans` table is authoritative for prices
 * (admins edit them in Commercial Settings); these mirror the seeded rows and
 * are used for display fallbacks, typing and legacy entitlement lookups.
 */
export interface PlanDefinition {
  area: MarketplaceArea;
  tier: PlanTier;
  name: string;
  priceCents: number;
  billingFrequency: "30_days" | "fixed_term";
  /** Retail plan code shared by all areas, e.g. RETAIL_6M. */
  planCode?: string;
  durationDays: number;
  /** Simultaneous active posts. Slots are reusable when a post is sold or deactivated. */
  slotCapacity: number;
  promoLabel?: string;
  /** Price of the same period bought as separate 30-day plans. */
  compareAtCents?: number;
  legacy?: boolean;
  features: {
    maxListings?: number;
    maxPhotos: number;
    maxBusinesses?: number;
    maxPromotions?: number;
    maxPostsPerMonth: number;
    videoAllowed: boolean;
    maxVideos?: number;
    boostAllowed: boolean;
    featuredAllowed: boolean;
    urgentAllowed: boolean;
  };
}

export interface PlanFeatureItem {
  text: string;
  included: boolean;
}

export interface RetailOffer {
  tier: RetailPlanTier;
  planCode: string;
  label: string;
  priceCents: number;
  durationDays: number;
  promoLabel: string;
  compareAtCents?: number;
}

/** One price ladder for Market, Business and Tourism. */
export const RETAIL_OFFERS: readonly RetailOffer[] = [
  {
    tier: "month",
    planCode: "RETAIL_30D",
    label: "30 Days",
    priceCents: 5000,
    durationDays: 30,
    promoLabel: "Flexible",
  },
  {
    tier: "half_year",
    planCode: "RETAIL_6M",
    label: "6 Months",
    priceCents: 25000,
    durationDays: 180,
    promoLabel: "Most popular",
    compareAtCents: 30000,
  },
  {
    tier: "year",
    planCode: "RETAIL_12M",
    label: "12 Months",
    priceCents: 45000,
    durationDays: 365,
    promoLabel: "Best value",
    compareAtCents: 60000,
  },
];

const RETAIL_FEATURES: PlanDefinition["features"] = {
  maxPhotos: 10,
  maxPostsPerMonth: 10,
  videoAllowed: true,
  maxVideos: 1,
  boostAllowed: true,
  featuredAllowed: true,
  urgentAllowed: true,
};

const AREA_PLAN_NAMES: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "Mzansi Market",
  MZANSI_BUSINESS: "Mzansi Business",
  PROMOTIONS_EVENTS: "Tourism",
};

const AREA_CAPACITY_KEY: Record<
  MarketplaceArea,
  "maxListings" | "maxBusinesses" | "maxPromotions"
> = {
  MZANSI_MARKET: "maxListings",
  MZANSI_BUSINESS: "maxBusinesses",
  PROMOTIONS_EVENTS: "maxPromotions",
};

export const PLANS: PlanDefinition[] = ACTIVE_MARKETPLACE_AREAS.flatMap((area) =>
  RETAIL_OFFERS.map((offer) => ({
    area,
    tier: offer.tier,
    name: `${AREA_PLAN_NAMES[area]} — ${offer.label}`,
    priceCents: offer.priceCents,
    billingFrequency: "fixed_term" as const,
    planCode: offer.planCode,
    durationDays: offer.durationDays,
    slotCapacity: 1,
    promoLabel: offer.promoLabel,
    compareAtCents: offer.compareAtCents,
    features: { ...RETAIL_FEATURES, [AREA_CAPACITY_KEY[area]]: 1 },
  }))
);

export interface EnterprisePlanDefinition {
  planCode: string;
  slots: number;
  durationDays: number;
  label: string;
  priceCents: number;
  monthlyActivations: number;
}

const ENTERPRISE_PRICE_TABLE: ReadonlyArray<readonly [number, number, readonly number[]]> = [
  [50, 100, [500000, 900000, 1600000]],
  [100, 200, [900000, 1600000, 2800000]],
  [250, 500, [2000000, 3500000, 6000000]],
  [500, 1000, [3500000, 6000000, 10000000]],
];

const ENTERPRISE_TERMS: ReadonlyArray<readonly [string, string, number]> = [
  ["3M", "3 Months", 90],
  ["6M", "6 Months", 180],
  ["12M", "12 Months", 365],
];

/** Bulk active-slot plans covering all areas. 1,000+ slots are quoted manually. */
export const ENTERPRISE_PLANS: readonly EnterprisePlanDefinition[] = ENTERPRISE_PRICE_TABLE.flatMap(
  ([slots, monthlyActivations, prices]) =>
    ENTERPRISE_TERMS.map(([suffix, label, durationDays], index) => ({
      planCode: `ENT_${slots}_${suffix}`,
      slots,
      durationDays,
      label,
      priceCents: prices[index] ?? 0,
      monthlyActivations,
    }))
);

type LegacyLimits = {
  maxListings?: number;
  maxBusinesses?: number;
  maxPromotions?: number;
  maxVideos: number;
  videoAllowed?: boolean;
  boost: boolean;
  premium?: boolean;
};

function legacyPlan(
  area: MarketplaceArea,
  tier: PlanTier,
  priceCents: number,
  limits: LegacyLimits
): PlanDefinition {
  const capacity = limits.maxListings ?? limits.maxBusinesses ?? limits.maxPromotions ?? 1;
  return {
    area,
    tier,
    name: `${AREA_PLAN_NAMES[area]} ${tier.charAt(0).toUpperCase()}${tier.slice(1)} (legacy)`,
    priceCents,
    billingFrequency: "30_days",
    durationDays: 30,
    slotCapacity: capacity,
    legacy: true,
    features: {
      maxListings: limits.maxListings,
      maxBusinesses: limits.maxBusinesses,
      maxPromotions: limits.maxPromotions,
      maxPhotos: 10,
      maxPostsPerMonth: capacity * 5,
      videoAllowed: limits.videoAllowed ?? true,
      maxVideos: limits.maxVideos,
      boostAllowed: limits.boost,
      featuredAllowed: limits.premium ?? false,
      urgentAllowed: limits.premium ?? false,
    },
  };
}

/** Retired per-area tiers. Existing entitlements keep these limits until they expire. */
export const LEGACY_PLANS: PlanDefinition[] = [
  legacyPlan("MZANSI_MARKET", "basic", 3000, {
    maxListings: 1,
    maxVideos: 0,
    videoAllowed: false,
    boost: false,
  }),
  legacyPlan("MZANSI_MARKET", "starter", 10000, { maxListings: 3, maxVideos: 1, boost: false }),
  legacyPlan("MZANSI_MARKET", "growth", 25000, { maxListings: 9, maxVideos: 3, boost: true }),
  legacyPlan("MZANSI_MARKET", "pro", 65000, {
    maxListings: 27,
    maxVideos: 27,
    boost: true,
    premium: true,
  }),
  legacyPlan("MZANSI_BUSINESS", "starter", 15000, { maxBusinesses: 1, maxVideos: 1, boost: false }),
  legacyPlan("MZANSI_BUSINESS", "growth", 40000, { maxBusinesses: 3, maxVideos: 3, boost: true }),
  legacyPlan("MZANSI_BUSINESS", "pro", 100000, {
    maxBusinesses: 9,
    maxVideos: 9,
    boost: true,
    premium: true,
  }),
  legacyPlan("PROMOTIONS_EVENTS", "starter", 15000, {
    maxPromotions: 1,
    maxVideos: 1,
    boost: false,
  }),
  legacyPlan("PROMOTIONS_EVENTS", "growth", 40000, { maxPromotions: 3, maxVideos: 3, boost: true }),
  legacyPlan("PROMOTIONS_EVENTS", "pro", 100000, {
    maxPromotions: 9,
    maxVideos: 9,
    boost: true,
    premium: true,
  }),
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
 * One introductory post across all marketplace areas.
 * Each verified identity chooses seven days or a limited 30-day launch trial.
 * Free posts expire after the configured duration.
 */
export const FREE_POST_CONFIG = {
  durationDays: 7,
  maxPhotos: 10,
  maxVideos: 1,
  videoAllowed: true,
  maxAllowed: 1, // one introductory post across all areas
} as const;

export const PAID_POST_CONFIG = {
  durationDays: 30,
} as const;

/** Events are free until they end; fair-use limits live in commercial settings. */
export const EVENT_POST_CONFIG = {
  priceCents: 0,
  maxActivePerAccount: 5,
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

export function getActivePlanByCheckoutId(planId: string): PlanDefinition | undefined {
  return getActivePlans().find((plan) => getPlanCheckoutId(plan) === planId);
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

  push(
    plan.slotCapacity === 1
      ? "1 active posting slot — reuse it when an item sells"
      : `${plan.slotCapacity} active posting slots`
  );
  push(`${formatDurationDays(plan.durationDays)} of visibility`);
  push(`${features.maxPhotos} photos per post`);
  push(
    features.maxVideos !== undefined
      ? `${features.maxVideos} video${features.maxVideos === 1 ? "" : "s"}`
      : "Videos",
    features.videoAllowed
  );
  push("Optional Boost, Featured and Urgent add-ons", features.boostAllowed);
  push("No automatic renewal");

  return items;
}

export function formatDurationDays(days: number): string {
  if (days % 365 === 0) return days === 365 ? "12 months" : `${days / 365} years`;
  if (days % 30 === 0 && days >= 60) return `${days / 30} months`;
  return `${days} days`;
}

/** Savings versus buying the same period as separate 30-day plans. */
export function getRetailSavingsCents(
  offer: Pick<RetailOffer, "priceCents" | "compareAtCents">
): number {
  return offer.compareAtCents ? Math.max(0, offer.compareAtCents - offer.priceCents) : 0;
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

export function isLegacyPlanTier(tier: string | null | undefined): boolean {
  return tier === "basic" || tier === "starter" || tier === "growth" || tier === "pro";
}

/**
 * Get a specific plan.
 */
export function getPlan(area: MarketplaceArea, tier: PlanTier): PlanDefinition | undefined {
  return (
    PLANS.find((p) => p.area === area && p.tier === tier) ??
    LEGACY_PLANS.find((p) => p.area === area && p.tier === tier)
  );
}

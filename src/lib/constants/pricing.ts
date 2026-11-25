import type { MarketplaceArea, PlanTier, RetailPlanTier } from "@/types/enums";
import { formatRandAmount } from "@/lib/utils/format";
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
  /** Retail plan code shared by all areas, e.g. RETAIL_90D. */
  planCode?: string;
  durationDays: number;
  /** Simultaneous active posts. A slot is reusable once its post is deleted. */
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

/**
 * Individual slots (posting terms posting-v4, Pricing v2): R69 per slot for
 * each 30 days, in any section, with no discount for longer terms. Every term
 * is a fixed number of days from the confirmed payment, never calendar months.
 * The database catalogue decides what is on sale; these are the prices shown
 * while nothing is (and the display fallback).
 */
export const RETAIL_OFFERS: readonly RetailOffer[] = [
  {
    tier: "month",
    planCode: "RETAIL_30D",
    label: "30 Days",
    priceCents: 6900,
    durationDays: 30,
    promoLabel: "",
  },
  {
    tier: "quarter",
    planCode: "RETAIL_90D",
    label: "90 Days",
    priceCents: 20700,
    durationDays: 90,
    promoLabel: "",
  },
  {
    tier: "half_year",
    planCode: "RETAIL_180D",
    label: "180 Days",
    priceCents: 41400,
    durationDays: 180,
    promoLabel: "",
  },
];

/**
 * Multi-listing and Business Sponsor packages are not sold under posting-v4
 * (Pricing v2: their prices are published only with a terms version that
 * states them). If set to false, the pricing, multi-listing and Advertise pages
 * and the posting flow show no multi-listing plans and no sponsor fees.
 *
 * True in production and every build (owner's decision of 22 November 2026:
 * hide nothing before launch). Selling a package also depends on the
 * database's packages sales switch (private.slot_package_sales), which only the owner
 * turns on. Typed as `boolean` so the code for both states still type-checks.
 */
export const PACKAGES_ON_SALE: boolean = true;

const RETAIL_FEATURES: PlanDefinition["features"] = {
  maxPhotos: 10,
  // posting-v4 fair use: at most 4 posts going live per paid slot per 30 days.
  maxPostsPerMonth: 4,
  videoAllowed: true,
  maxVideos: 1,
};

const AREA_PLAN_NAMES: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "Mzansi Market",
  MZANSI_BUSINESS: "Mzansi Business",
  PROMOTIONS_EVENTS: "Tourism & Events",
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

/** Group 3 sponsor programme: total fee by capacity and term (Document 03 §5). */
export interface SponsorProgrammePrice {
  capacity: number;
  price90Cents: number;
  price180Cents: number;
}

export const SPONSOR_PROGRAMME_PRICES: readonly SponsorProgrammePrice[] = [
  { capacity: 25, price90Cents: 1_500_000, price180Cents: 2_500_000 },
  { capacity: 50, price90Cents: 2_250_000, price180Cents: 4_000_000 },
  { capacity: 100, price90Cents: 3_500_000, price180Cents: 6_500_000 },
  { capacity: 250, price90Cents: 7_500_000, price180Cents: 14_000_000 },
];

/** Programme administrators included with every sponsor programme. */
export const SPONSOR_PROGRAMME_ADMINS = 3;

type LegacyLimits = {
  maxListings?: number;
  maxBusinesses?: number;
  maxPromotions?: number;
  maxVideos: number;
  videoAllowed?: boolean;
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
    },
  };
}

/** Retired per-area tiers. Existing entitlements keep these limits until they expire. */
export const LEGACY_PLANS: PlanDefinition[] = [
  // Retired 365-day retail term (Document 03 v3.2 sells no annual package).
  ...ACTIVE_MARKETPLACE_AREAS.map((area): PlanDefinition => ({
    area,
    tier: "year",
    name: `${AREA_PLAN_NAMES[area]} — 365 Days (retired)`,
    priceCents: 45000,
    billingFrequency: "fixed_term",
    planCode: "RETAIL_12M",
    durationDays: 365,
    slotCapacity: 1,
    legacy: true,
    features: { ...RETAIL_FEATURES, [AREA_CAPACITY_KEY[area]]: 1 },
  })),
  legacyPlan("MZANSI_MARKET", "basic", 3000, {
    maxListings: 1,
    maxVideos: 0,
    videoAllowed: false,
  }),
  legacyPlan("MZANSI_MARKET", "starter", 10000, { maxListings: 3, maxVideos: 1 }),
  legacyPlan("MZANSI_MARKET", "growth", 25000, { maxListings: 9, maxVideos: 3 }),
  legacyPlan("MZANSI_MARKET", "pro", 65000, {
    maxListings: 27,
    maxVideos: 27,
  }),
  legacyPlan("MZANSI_BUSINESS", "starter", 15000, { maxBusinesses: 1, maxVideos: 1 }),
  legacyPlan("MZANSI_BUSINESS", "growth", 40000, { maxBusinesses: 3, maxVideos: 3 }),
  legacyPlan("MZANSI_BUSINESS", "pro", 100000, {
    maxBusinesses: 9,
    maxVideos: 9,
  }),
  legacyPlan("PROMOTIONS_EVENTS", "starter", 15000, {
    maxPromotions: 1,
    maxVideos: 1,
  }),
  legacyPlan("PROMOTIONS_EVENTS", "growth", 40000, { maxPromotions: 3, maxVideos: 3 }),
  legacyPlan("PROMOTIONS_EVENTS", "pro", 100000, {
    maxPromotions: 9,
    maxVideos: 9,
  }),
];

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
 * Seven days, once per ID-reviewed identity (the 30-day launch option has ended).
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

export function formatPlanPrice(priceCents: number): string {
  return `R${formatRandAmount(priceCents / 100, priceCents % 100 === 0 ? 0 : 2)}`;
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

  push(
    plan.slotCapacity === 1
      ? "1 active posting slot — reuse it once its post is deleted"
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
  push("No automatic renewal");

  return items;
}

/** Terms are stated in days (Document 03 fixed-day rule), never calendar months. */
export function formatDurationDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

/** 30-day equivalent of a longer term, e.g. R414 / 180 days → "R69". */
export function formatThirtyDayEquivalent(priceCents: number, durationDays: number): string | null {
  if (durationDays <= 30) return null;
  return formatPlanPrice(Math.round((priceCents * 30) / durationDays));
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

/**
 * Get plans for a specific marketplace area.
 */
export function getPlansForArea(area: MarketplaceArea): PlanDefinition[] {
  return PLANS.filter((p) => p.area === area);
}

export function isLegacyPlanTier(tier: string | null | undefined): boolean {
  return (
    tier === "basic" || tier === "starter" || tier === "growth" || tier === "pro" || tier === "year"
  );
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

import { PLANS } from "../src/lib/constants/pricing";
import type { MarketplaceArea, PlanTier } from "../src/types/enums";

export type SeedPlanContractRow = {
  area: MarketplaceArea;
  tier: PlanTier;
  name: string;
  price_cents: number;
  billing_frequency: "30_days";
  active: true;
};

export const SEED_CONTRACT_VERSION = "2026-03-06";

export const ACTIVE_RUNTIME_PLAN_AREAS: MarketplaceArea[] = [
  "MZANSI_MARKET",
  "MZANSI_BUSINESS",
  "PROMOTIONS_EVENTS",
];

export const EXPECTED_ACTIVE_PLAN_ROWS: SeedPlanContractRow[] = PLANS.filter((plan) =>
  ACTIVE_RUNTIME_PLAN_AREAS.includes(plan.area)
).map((plan) => ({
  area: plan.area,
  tier: plan.tier,
  name: plan.name,
  price_cents: plan.priceCents,
  billing_frequency: plan.billingFrequency,
  active: true,
}));

export function normalizePlanBillingFrequency(value: string): "30_days" | string {
  return value === "monthly" ? "30_days" : value;
}

export const EXPECTED_FEATURE_FLAG_KEYS = [
  "kyc_v2_flow",
  "kyc_gps_location",
  "kyc_evidence_desk",
] as const;

export function getPlanContractKey(row: Pick<SeedPlanContractRow, "area" | "tier">): string {
  return `${row.area}:${row.tier}`;
}

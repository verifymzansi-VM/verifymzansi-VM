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

export const EXPECTED_ACTIVE_PLAN_ROWS: SeedPlanContractRow[] = PLANS.map((plan) => ({
  area: plan.area,
  tier: plan.tier,
  name: plan.name,
  price_cents: plan.priceCents,
  billing_frequency: plan.billingFrequency,
  active: true,
}));

export const EXPECTED_FEATURE_FLAG_KEYS = [
  "kyc_v2_flow",
  "kyc_gps_location",
  "kyc_evidence_desk",
] as const;

export function getPlanContractKey(row: Pick<SeedPlanContractRow, "area" | "tier">): string {
  return `${row.area}:${row.tier}`;
}

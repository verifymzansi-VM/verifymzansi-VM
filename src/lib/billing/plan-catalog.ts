import { getPlan, isActiveMarketplaceArea, type PlanDefinition } from "@/lib/constants/pricing";
import type { MarketplaceArea, PlanTier } from "@/types/enums";

export type CanonicalPlanRow = {
  id: string;
  area: MarketplaceArea;
  tier: PlanTier;
  name?: string;
  price_cents: number;
  active: boolean;
  features?: Record<string, unknown>;
};

export function getCanonicalActivePlanDefinition(
  area: MarketplaceArea,
  tier: PlanTier
): PlanDefinition | null {
  if (!isActiveMarketplaceArea(area)) {
    return null;
  }

  return getPlan(area, tier) ?? null;
}

export function validateCanonicalPaidPlan(row: CanonicalPlanRow): string | null {
  if (!row.active) {
    return "Plan is inactive";
  }

  const expected = getCanonicalActivePlanDefinition(row.area, row.tier);
  if (!expected) {
    return "Plan is not in the active package catalog";
  }

  if (row.price_cents !== expected.priceCents) {
    return "Plan price does not match the active package catalog";
  }

  return null;
}

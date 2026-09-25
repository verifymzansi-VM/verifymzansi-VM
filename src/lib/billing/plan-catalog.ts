import { isLegacyPlanTier } from "@/lib/constants/pricing";
import type { MarketplaceArea, PlanTier } from "@/types/enums";

export type CanonicalPlanRow = {
  id: string;
  area: MarketplaceArea | null;
  tier: PlanTier;
  name?: string;
  price_cents: number;
  active: boolean;
  features?: Record<string, unknown>;
  is_legacy?: boolean;
};

const SELLABLE_TIERS: ReadonlySet<string> = new Set(["month", "half_year", "year", "enterprise"]);

/**
 * A plan is sellable when it is active, current (not a retired legacy tier) and
 * priced. The `plans` row is authoritative for price: admins edit it in
 * Commercial Settings, and fulfilment re-checks the paid amount against it.
 */
export function validateCanonicalPaidPlan(row: CanonicalPlanRow): string | null {
  if (!row.active) {
    return "Plan is inactive";
  }

  if (row.is_legacy || isLegacyPlanTier(row.tier) || !SELLABLE_TIERS.has(row.tier)) {
    return "Plan is not in the active package catalog";
  }

  if (!Number.isInteger(row.price_cents) || row.price_cents <= 0) {
    return "Plan price is invalid";
  }

  if (row.tier !== "enterprise" && !row.area) {
    return "Plan area is missing";
  }

  return null;
}

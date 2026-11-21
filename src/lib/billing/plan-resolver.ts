import { getStablePlanId } from "@/lib/constants/plan-ids";
import { getActivePlans } from "@/lib/constants/pricing";
import type { MarketplaceArea, PlanTier } from "@/types/enums";

type PlanTokenMatch = { area: MarketplaceArea; tier: PlanTier };

const ACTIVE_PLAN_TOKEN_MAP = new Map<string, PlanTokenMatch>(
  getActivePlans().map((plan) => [getStablePlanId(plan.area, plan.tier), plan])
);

/** The section and term a stable retail plan link names, or null. Plans
 * themselves come from the foundation catalogue (billing-plan-selection.ts). */
export function getActivePlanSelectionFromToken(planToken: string): PlanTokenMatch | null {
  return ACTIVE_PLAN_TOKEN_MAP.get(planToken) ?? null;
}

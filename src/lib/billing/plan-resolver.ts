import { getStablePlanId } from "@/lib/constants/plan-ids";
import { getActivePlans } from "@/lib/constants/pricing";
import type { MarketplaceArea, PlanTier } from "@/types/enums";

export interface BillingPlanRow {
  id: string;
  area: MarketplaceArea;
  tier: PlanTier;
  name: string;
  price_cents: number;
  active: boolean;
  billing_frequency?: string;
  features?: Record<string, unknown>;
}

type PlanTokenMatch = Pick<BillingPlanRow, "area" | "tier">;

type SupabasePlanClient = {
  from: (table: "plans") => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => unknown;
    };
  };
};

type PlanQueryResult = Promise<{
  data: BillingPlanRow | null;
  error?: { message?: string; code?: string } | null;
}>;

const PLAN_SELECT = "id, area, tier, name, price_cents, active, billing_frequency, features";

const ACTIVE_PLAN_TOKEN_MAP = new Map<string, PlanTokenMatch>(
  getActivePlans().map((plan) => [getStablePlanId(plan.area, plan.tier), plan])
);

function asPlanQueryResult(query: unknown): PlanQueryResult {
  return (query as { maybeSingle: () => PlanQueryResult }).maybeSingle();
}

function appendEq(query: unknown, column: string, value: unknown): unknown {
  return (query as { eq: (nextColumn: string, nextValue: unknown) => unknown }).eq(column, value);
}

async function queryPlanById(
  client: SupabasePlanClient,
  planId: string,
  options?: { requireActive?: boolean }
): PlanQueryResult {
  let query = client.from("plans").select(PLAN_SELECT).eq("id", planId);

  if (options?.requireActive) {
    query = appendEq(query, "active", true) as typeof query;
  }

  return asPlanQueryResult(query);
}

async function queryActivePlanByAreaTier(
  client: SupabasePlanClient,
  match: PlanTokenMatch
): PlanQueryResult {
  let query = client.from("plans").select(PLAN_SELECT).eq("area", match.area);
  query = appendEq(query, "tier", match.tier) as typeof query;
  query = appendEq(query, "active", true) as typeof query;
  return asPlanQueryResult(query);
}

export function getActivePlanSelectionFromToken(planToken: string): PlanTokenMatch | null {
  return ACTIVE_PLAN_TOKEN_MAP.get(planToken) ?? null;
}

export async function resolveBillingPlanSelection(
  client: SupabasePlanClient,
  planToken: string,
  options?: { requireActive?: boolean }
): Promise<{
  plan: BillingPlanRow | null;
  error?: { message?: string; code?: string } | null;
  source: "id" | "stable-token" | null;
}> {
  const direct = await queryPlanById(client, planToken, options);
  if (direct.error) {
    return { plan: null, error: direct.error, source: null };
  }
  if (direct.data) {
    return { plan: direct.data, error: null, source: "id" };
  }

  const match = getActivePlanSelectionFromToken(planToken);
  if (!match) {
    return { plan: null, error: null, source: null };
  }

  const fallback = await queryActivePlanByAreaTier(client, match);
  if (fallback.error) {
    return { plan: null, error: fallback.error, source: null };
  }

  return {
    plan: fallback.data,
    error: null,
    source: fallback.data ? "stable-token" : null,
  };
}

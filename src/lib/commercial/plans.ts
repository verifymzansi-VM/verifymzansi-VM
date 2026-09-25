import "server-only";

import { getStablePlanId } from "@/lib/constants/plan-ids";
import {
  ACTIVE_MARKETPLACE_AREAS,
  ENTERPRISE_PLANS,
  RETAIL_OFFERS,
  type EnterprisePlanDefinition,
  type RetailOffer,
} from "@/lib/constants/pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import type { MarketplaceArea, RetailPlanTier } from "@/types/enums";

const log = createLogger("CommercialPlans");

export interface RetailCatalogOffer extends RetailOffer {
  /** Checkout plan id per area (DB id, or stable token when the DB is unavailable). */
  planIds: Record<MarketplaceArea, string>;
}

export interface EnterpriseCatalogPlan extends EnterprisePlanDefinition {
  planId: string | null;
}

export interface CommercialCatalog {
  retail: RetailCatalogOffer[];
  enterprise: EnterpriseCatalogPlan[];
  source: "database" | "defaults";
}

type PlanRow = {
  id: string;
  area: MarketplaceArea | null;
  tier: string;
  name: string;
  price_cents: number;
  plan_code: string | null;
  duration_days: number | null;
  slot_capacity: number | null;
  monthly_activation_limit: number | null;
  promo_label: string | null;
  compare_at_cents: number | null;
  public: boolean;
  active: boolean;
};

function defaultCatalog(): CommercialCatalog {
  return {
    source: "defaults",
    retail: RETAIL_OFFERS.map((offer) => ({
      ...offer,
      planIds: Object.fromEntries(
        ACTIVE_MARKETPLACE_AREAS.map((area) => [area, getStablePlanId(area, offer.tier)])
      ) as Record<MarketplaceArea, string>,
    })),
    enterprise: ENTERPRISE_PLANS.map((plan) => ({ ...plan, planId: null })),
  };
}

/** Build the public catalogue from `plans` rows (authoritative prices). */
export function buildCommercialCatalog(rows: readonly PlanRow[]): CommercialCatalog {
  const fallback = defaultCatalog();
  const sellable = rows.filter((row) => row.active && row.public);

  const retail = fallback.retail.map((offer) => {
    const matches = sellable.filter((row) => row.tier === offer.tier && row.area);
    const reference = matches[0];
    if (!reference) return offer;
    const planIds = { ...offer.planIds };
    for (const row of matches) planIds[row.area as MarketplaceArea] = row.id;
    return {
      ...offer,
      priceCents: reference.price_cents,
      durationDays: reference.duration_days ?? offer.durationDays,
      promoLabel: reference.promo_label ?? offer.promoLabel,
      compareAtCents: reference.compare_at_cents ?? undefined,
      planIds,
    };
  });

  const enterprise = sellable
    .filter((row) => row.tier === "enterprise" && row.plan_code)
    .map((row) => {
      const known = ENTERPRISE_PLANS.find((plan) => plan.planCode === row.plan_code);
      return {
        planCode: row.plan_code as string,
        slots: row.slot_capacity ?? known?.slots ?? 0,
        durationDays: row.duration_days ?? known?.durationDays ?? 90,
        label: known?.label ?? `${row.duration_days ?? 90} days`,
        priceCents: row.price_cents,
        monthlyActivations: row.monthly_activation_limit ?? known?.monthlyActivations ?? 0,
        planId: row.id,
      };
    })
    .sort((a, b) => a.slots - b.slots || a.durationDays - b.durationDays);

  return {
    source: "database",
    retail,
    enterprise: enterprise.length > 0 ? enterprise : fallback.enterprise,
  };
}

export async function getCommercialCatalog(): Promise<CommercialCatalog> {
  try {
    const { data, error } = await createAdminClient()
      .from("plans")
      .select(
        "id, area, tier, name, price_cents, plan_code, duration_days, slot_capacity, monthly_activation_limit, promo_label, compare_at_cents, public, active"
      )
      .eq("active", true);
    if (error || !data) {
      if (error) log.warn("Falling back to default plan catalogue", { error: error.message });
      return defaultCatalog();
    }
    return buildCommercialCatalog(data as PlanRow[]);
  } catch (error) {
    log.warn("Falling back to default plan catalogue", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return defaultCatalog();
  }
}

export function retailTierLabel(tier: RetailPlanTier): string {
  return RETAIL_OFFERS.find((offer) => offer.tier === tier)?.label ?? tier;
}

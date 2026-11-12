import "server-only";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import {
  readFoundationBillingCatalogue,
  type FoundationBillingCatalogue,
} from "@/lib/foundation/billing-catalogue";

import { getStablePlanId } from "@/lib/constants/plan-ids";
import {
  ACTIVE_MARKETPLACE_AREAS,
  ENTERPRISE_PLANS,
  RETAIL_OFFERS,
  type EnterprisePlanDefinition,
  type RetailOffer,
} from "@/lib/constants/pricing";
import { createLogger } from "@/lib/utils/logger";
import type { MarketplaceArea } from "@/types/enums";

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
  /** Whether a retail plan can be bought: only plans the database lists as on
   * sale. Without one (paid slots paused, or the catalogue unreadable) the
   * prices are shown but nothing links to checkout. */
  onSale: boolean;
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
    onSale: false,
  };
}

/** Build the public catalogue from plan rows (authoritative prices). */
export function buildCommercialCatalog(rows: readonly PlanRow[]): CommercialCatalog {
  const fallback = defaultCatalog();
  const sellable = rows.filter((row) => row.active && row.public);
  const retailOnSale = fallback.retail.some((offer) =>
    sellable.some((row) => row.tier === offer.tier && row.area)
  );

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
    onSale: retailOnSale,
  };
}

export function buildFoundationCommercialCatalog(
  catalogue: FoundationBillingCatalogue
): CommercialCatalog {
  const areas = {
    market: "MZANSI_MARKET",
    business: "MZANSI_BUSINESS",
    tourism_events: "PROMOTIONS_EVENTS",
  } as const;
  return buildCommercialCatalog(
    catalogue.plans.flatMap((plan): PlanRow[] => {
      const retail =
        plan.slot_capacity === 1 &&
        plan.area &&
        RETAIL_OFFERS.find((offer) => offer.durationDays === plan.duration_days);
      const enterprise =
        plan.slot_capacity > 1 &&
        ENTERPRISE_PLANS.find(
          (offer) => offer.slots === plan.slot_capacity && offer.durationDays === plan.duration_days
        );
      if (!retail && !enterprise) return [];
      return [
        {
          id: plan.id,
          area: plan.area ? areas[plan.area] : null,
          tier: retail ? retail.tier : "enterprise",
          name: plan.label,
          price_cents: Number(plan.price_cents),
          plan_code: enterprise ? enterprise.planCode : retail ? retail.planCode : null,
          duration_days: plan.duration_days,
          slot_capacity: plan.slot_capacity,
          monthly_activation_limit: plan.activations_per_period ?? null,
          promo_label: retail ? retail.promoLabel : null,
          compare_at_cents: null,
          public: true,
          active: true,
        },
      ];
    })
  );
}

export async function getCommercialCatalog(): Promise<CommercialCatalog> {
  try {
    return buildFoundationCommercialCatalog(
      await readFoundationBillingCatalogue(foundationServerPublicApi())
    );
  } catch (error) {
    log.warn("Falling back to default plan catalogue", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return defaultCatalog();
  }
}

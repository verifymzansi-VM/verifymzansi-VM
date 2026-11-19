import "server-only";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import {
  isIndividualSlotPlan,
  readFoundationBillingCatalogue,
  type FoundationBillingCatalogue,
} from "@/lib/foundation/billing-catalogue";

import { getStablePlanId } from "@/lib/constants/plan-ids";
import { ACTIVE_MARKETPLACE_AREAS, RETAIL_OFFERS, type RetailOffer } from "@/lib/constants/pricing";
import { createLogger } from "@/lib/utils/logger";
import type { MarketplaceArea } from "@/types/enums";

const log = createLogger("CommercialPlans");

export interface RetailCatalogOffer extends RetailOffer {
  /** Checkout plan id per area (DB id, or stable token when the DB is unavailable). */
  planIds: Record<MarketplaceArea, string>;
}

export interface CommercialCatalog {
  retail: RetailCatalogOffer[];
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

  return {
    source: "database",
    retail,
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
      // An Individual slot (posting-v4) works in any section: the same plan
      // serves the offer in each of them.
      if (isIndividualSlotPlan(plan)) {
        const offer = RETAIL_OFFERS.find((entry) => entry.durationDays === plan.duration_days);
        if (!offer) return [];
        return Object.values(areas).map((area) => ({
          id: plan.id,
          area,
          tier: offer.tier,
          name: plan.label,
          price_cents: Number(plan.price_cents),
          plan_code: offer.planCode,
          duration_days: plan.duration_days,
          slot_capacity: plan.slot_capacity,
          monthly_activation_limit: plan.activations_per_period ?? null,
          promo_label: offer.promoLabel,
          compare_at_cents: null,
          public: true,
          active: true,
        }));
      }
      const retail =
        plan.slot_capacity === 1 &&
        plan.area &&
        RETAIL_OFFERS.find((offer) => offer.durationDays === plan.duration_days);
      // Multi-listing packages are not catalogue plans: they are bought on
      // their own checkout (src/lib/billing/slot-packages.ts).
      if (!retail) return [];
      return [
        {
          id: plan.id,
          area: plan.area ? areas[plan.area] : null,
          tier: retail.tier,
          name: plan.label,
          price_cents: Number(plan.price_cents),
          plan_code: retail.planCode,
          duration_days: plan.duration_days,
          slot_capacity: plan.slot_capacity,
          monthly_activation_limit: plan.activations_per_period ?? null,
          promo_label: retail.promoLabel,
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

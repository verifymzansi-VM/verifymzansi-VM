import "server-only";
import { createFoundationPublicApi } from "./public-api";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { readFoundationBillingCatalogue } from "./billing-catalogue";
import { formatDurationDays, ENTERPRISE_ADMINS_INCLUDED } from "../constants/pricing";
import { selectFoundationBillingPlan } from "./billing-plan-selection";

const areas = {
  market: "Mzansi Market",
  business: "Mzansi Business",
  tourism_events: "Tourism & Events",
};

/** Keep the selected checkout summary interface and deterministic pricing links.
 * All chargeable terms come from the public catalogue, never legacy tables. */
export async function readFoundationCheckoutSummary(planId: string) {
  const catalogue = await readFoundationBillingCatalogue(
    createFoundationPublicApi(readFoundationRuntimeConnection())
  );
  const plan = selectFoundationBillingPlan(catalogue, planId);
  // Refuse a partial/old catalogue instead of concealing purchase limits.
  if (!plan || plan.activation_period_days !== 30 || plan.activations_per_period === undefined)
    return null;
  return {
    planId: plan.id,
    name: plan.label,
    areaLabel: plan.area ? areas[plan.area] : "All sections",
    priceCents: Number(plan.price_cents),
    durationDays: plan.duration_days,
    durationLabel: formatDurationDays(plan.duration_days),
    slotCapacity: plan.slot_capacity,
    monthlyActivationLimit: plan.activations_per_period,
    administrators: plan.slot_capacity > 1 ? ENTERPRISE_ADMINS_INCLUDED : null,
    expiryNotice:
      "Posts become inactive. Renew within 30 days before the post and its media are deleted.",
  };
}

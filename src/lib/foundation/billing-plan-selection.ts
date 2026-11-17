import { getActivePlanSelectionFromToken } from "../billing/plan-resolver";
import type { FoundationBillingCatalogue } from "./billing-catalogue";
import { foundationArea } from "./areas";

const days = { month: 30, quarter: 90, half_year: 180 };

/** Both the confirmation page and direct checkout buttons accept the selected
 * frontend's stable retail links. Ambiguous catalogues fail closed. */
export function selectFoundationBillingPlan(catalogue: FoundationBillingCatalogue, id: string) {
  const direct = catalogue.plans.find((plan) => plan.id === id);
  if (direct) return direct;
  const selection = getActivePlanSelectionFromToken(id);
  if (!selection || !(selection.tier in days)) return undefined;
  // A stable section link (section and term) also selects the Individual
  // slot, which works in every section.
  const matches = catalogue.plans.filter(
    (plan) =>
      (plan.area === foundationArea(selection.area) || plan.area === null) &&
      plan.slot_capacity === 1 &&
      plan.duration_days === days[selection.tier as keyof typeof days]
  );
  return matches.length === 1 ? matches[0] : undefined;
}

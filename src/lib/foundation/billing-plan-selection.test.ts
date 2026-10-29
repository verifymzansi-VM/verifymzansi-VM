import { expect, it } from "vitest";
import { getStablePlanId } from "../constants/plan-ids";
import { selectFoundationBillingPlan } from "./billing-plan-selection";
import type { FoundationBillingCatalogue } from "./billing-catalogue";
const plan = {
  id: "00000000-0000-4000-8000-000000000001",
  area: "market",
  slot_capacity: 1,
  duration_days: 30,
};
const catalogue = { plans: [plan], addons: [] } as unknown as FoundationBillingCatalogue;
it("resolves current UUIDs and preserved retail tokens through the same catalogue", () => {
  expect(selectFoundationBillingPlan(catalogue, plan.id)).toBe(plan);
  expect(selectFoundationBillingPlan(catalogue, getStablePlanId("MZANSI_MARKET", "month"))).toBe(
    plan
  );
});
it("rejects wrong-area, unknown and ambiguous stable selections", () => {
  expect(
    selectFoundationBillingPlan(catalogue, getStablePlanId("MZANSI_BUSINESS", "month"))
  ).toBeUndefined();
  expect(selectFoundationBillingPlan(catalogue, "unrecognised")).toBeUndefined();
  expect(
    selectFoundationBillingPlan(
      {
        ...catalogue,
        plans: [
          ...catalogue.plans,
          { ...catalogue.plans[0], id: "00000000-0000-4000-8000-000000000002" },
        ],
      },
      getStablePlanId("MZANSI_MARKET", "month")
    )
  ).toBeUndefined();
});

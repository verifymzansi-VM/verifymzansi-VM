import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/constants/pricing";
import { EXPECTED_ACTIVE_PLAN_ROWS, getPlanContractKey } from "../../scripts/seed-contract";

describe("Seed contract alignment", () => {
  it("defines exactly the runtime subscription plan catalog", () => {
    expect(EXPECTED_ACTIVE_PLAN_ROWS).toHaveLength(PLANS.length);
  });

  it("stays aligned with runtime pricing constants", () => {
    const runtimePlanRows = PLANS.map((plan) => ({
      area: plan.area,
      tier: plan.tier,
      name: plan.name,
      price_cents: plan.priceCents,
      billing_frequency: plan.billingFrequency,
    }));

    for (const expected of EXPECTED_ACTIVE_PLAN_ROWS) {
      const runtime = runtimePlanRows.find(
        (plan) =>
          getPlanContractKey({
            area: plan.area,
            tier: plan.tier,
          }) === getPlanContractKey(expected)
      );

      expect(runtime, `Missing runtime plan for ${expected.area}/${expected.tier}`).toBeTruthy();
      expect(runtime?.name).toBe(expected.name);
      expect(runtime?.price_cents).toBe(expected.price_cents);
      expect(runtime?.billing_frequency).toBe(expected.billing_frequency);
    }
  });
});

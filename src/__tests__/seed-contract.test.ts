import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/constants/pricing";
import { EXPECTED_ACTIVE_PLAN_ROWS, getPlanContractKey } from "../../scripts/seed-contract";

function isPaidTier(tier: string): tier is "starter" | "growth" | "pro" {
  return tier === "starter" || tier === "growth" || tier === "pro";
}

describe("Seed contract alignment", () => {
  it("defines exactly 15 active subscription plans", () => {
    expect(EXPECTED_ACTIVE_PLAN_ROWS).toHaveLength(15);
  });

  it("stays aligned with runtime pricing constants", () => {
    const runtimePlanRows = PLANS.filter((plan) => isPaidTier(plan.tier)).map((plan) => ({
      area: plan.area,
      tier: plan.tier as "starter" | "growth" | "pro",
      name: plan.name,
      price_cents: plan.priceCents,
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
    }
  });
});

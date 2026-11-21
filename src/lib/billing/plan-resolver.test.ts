import { describe, expect, it } from "vitest";
import { getStablePlanId } from "@/lib/constants/plan-ids";
import { getActivePlans } from "@/lib/constants/pricing";
import { getActivePlanSelectionFromToken } from "./plan-resolver";

describe("billing plan resolver", () => {
  it("maps every active plan's stable token to its section and term", () => {
    for (const plan of getActivePlans()) {
      expect(getActivePlanSelectionFromToken(getStablePlanId(plan.area, plan.tier))).toMatchObject({
        area: plan.area,
        tier: plan.tier,
      });
    }
  });

  it("returns null for unknown plan tokens", () => {
    expect(getActivePlanSelectionFromToken("550e8400-e29b-41d4-a716-446655440999")).toBeNull();
    expect(getActivePlanSelectionFromToken("")).toBeNull();
  });
});

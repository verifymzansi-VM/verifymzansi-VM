import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PLANS } from "@/lib/constants/pricing";
import { getStablePlanId } from "@/lib/constants/plan-ids";

describe("getStablePlanId", () => {
  it("returns deterministic RFC-compliant UUIDs for all runtime plans", () => {
    const uuid = z.string().uuid();

    for (const plan of PLANS) {
      const firstId = getStablePlanId(plan.area, plan.tier);
      const secondId = getStablePlanId(plan.area, plan.tier);

      expect(firstId).toBe(secondId);
      expect(() => uuid.parse(firstId)).not.toThrow();
    }
  });
});

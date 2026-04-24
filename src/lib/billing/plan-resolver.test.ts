import { describe, expect, it } from "vitest";
import { getStablePlanId } from "@/lib/constants/plan-ids";
import {
  getActivePlanSelectionFromToken,
  resolveBillingPlanSelection,
  type BillingPlanRow,
} from "./plan-resolver";

function createPlanClient(rows: BillingPlanRow[]) {
  return {
    from: () => ({
      select: () => ({
        eq(column: string, value: unknown) {
          const filters: Array<[string, unknown]> = [[column, value]];
          const chain = {
            eq(nextColumn: string, nextValue: unknown) {
              filters.push([nextColumn, nextValue]);
              return chain;
            },
            maybeSingle: async () => ({
              data:
                rows.find((row) =>
                  filters.every(([key, expected]) => row[key as keyof BillingPlanRow] === expected)
                ) ?? null,
              error: null,
            }),
          };
          return chain;
        },
      }),
    }),
  };
}

describe("billing plan resolver", () => {
  it("resolves canonical database plan ids directly", async () => {
    const client = createPlanClient([
      {
        id: "plan-db-growth",
        area: "MZANSI_MARKET",
        tier: "growth",
        name: "Mzansi Market Growth",
        price_cents: 25000,
        active: true,
      },
    ]);

    const result = await resolveBillingPlanSelection(client as never, "plan-db-growth", {
      requireActive: true,
    });

    expect(result.plan?.id).toBe("plan-db-growth");
    expect(result.source).toBe("id");
  });

  it("resolves stable frontend tokens to the active database row", async () => {
    const stableToken = getStablePlanId("MZANSI_MARKET", "growth");
    const client = createPlanClient([
      {
        id: "plan-db-growth",
        area: "MZANSI_MARKET",
        tier: "growth",
        name: "Mzansi Market Growth",
        price_cents: 25000,
        active: true,
      },
    ]);

    const result = await resolveBillingPlanSelection(client as never, stableToken, {
      requireActive: true,
    });

    expect(result.plan?.id).toBe("plan-db-growth");
    expect(result.plan?.tier).toBe("growth");
    expect(result.source).toBe("stable-token");
  });

  it("resolves the Basic stable frontend token to the active database row", async () => {
    const stableToken = getStablePlanId("MZANSI_MARKET", "basic");
    const client = createPlanClient([
      {
        id: "plan-db-basic",
        area: "MZANSI_MARKET",
        tier: "basic",
        name: "Mzansi Market Basic",
        price_cents: 3000,
        active: true,
      },
    ]);

    const result = await resolveBillingPlanSelection(client as never, stableToken, {
      requireActive: true,
    });

    expect(result.plan?.id).toBe("plan-db-basic");
    expect(result.plan?.tier).toBe("basic");
    expect(result.source).toBe("stable-token");
  });

  it("rejects inactive direct plan ids when active plans are required", async () => {
    const client = createPlanClient([
      {
        id: "plan-db-inactive",
        area: "MZANSI_MARKET",
        tier: "growth",
        name: "Mzansi Market Growth",
        price_cents: 25000,
        active: false,
      },
    ]);

    const result = await resolveBillingPlanSelection(client as never, "plan-db-inactive", {
      requireActive: true,
    });

    expect(result.plan).toBeNull();
    expect(result.source).toBeNull();
  });

  it("rejects stable tokens when the mapped area/tier has no active database row", async () => {
    const stableToken = getStablePlanId("MZANSI_MARKET", "growth");
    const client = createPlanClient([
      {
        id: "plan-db-inactive",
        area: "MZANSI_MARKET",
        tier: "growth",
        name: "Mzansi Market Growth",
        price_cents: 25000,
        active: false,
      },
    ]);

    const result = await resolveBillingPlanSelection(client as never, stableToken, {
      requireActive: true,
    });

    expect(getActivePlanSelectionFromToken(stableToken)).toMatchObject({
      area: "MZANSI_MARKET",
      tier: "growth",
    });
    expect(result.plan).toBeNull();
    expect(result.source).toBeNull();
  });

  it("returns null for unknown plan tokens", async () => {
    const client = createPlanClient([]);

    const result = await resolveBillingPlanSelection(
      client as never,
      "550e8400-e29b-41d4-a716-446655440999",
      { requireActive: true }
    );

    expect(result.plan).toBeNull();
    expect(result.source).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fulfillPayment } from "./fulfillment";
import type { PaymentRecordShape } from "./types";
import { getStablePlanId } from "@/lib/constants/plan-ids";
import {
  BOOST_DURATION_DAYS,
  FEATURED_DURATION_DAYS,
  URGENT_DURATION_DAYS,
} from "@/lib/constants/pricing";

const plan = {
  id: "db-plan",
  area: "MZANSI_MARKET",
  tier: "growth",
  name: "Growth",
  price_cents: 25000,
  active: true,
};
const payment: PaymentRecordShape = {
  id: "payment-1",
  user_id: "user-1",
  area: "MZANSI_MARKET",
  amount_cents: 25000,
  status: "pending",
  provider: "ozow",
  provider_payment_id: "ozow-1",
  provider_data: {
    type: "subscription",
    plan_id: plan.id,
    plan_tier: "growth",
    area: "MZANSI_MARKET",
  },
  created_at: "2026-09-09T10:00:00Z",
};

function client(rows: Array<Record<string, unknown>> = [plan]) {
  const rpc = vi.fn().mockResolvedValue({ data: { outcome: "completed" }, error: null });
  const from = vi.fn((table: string) => {
    expect(table).toBe("plans"); // No separate benefit/status writes are permitted.
    return {
      select: () => ({
        eq: (column: string, value: unknown) => {
          const filters: Array<[string, unknown]> = [[column, value]];
          const chain = {
            eq: (key: string, expected: unknown) => {
              filters.push([key, expected]);
              return chain;
            },
            maybeSingle: async () => ({
              data:
                rows.find((row) => filters.every(([key, expected]) => row[key] === expected)) ??
                null,
              error: null,
            }),
          };
          return chain;
        },
      }),
    };
  });
  return { from, rpc };
}

describe("atomic payment fulfillment adapter (effects are tested in test-payment-fulfillment.mjs)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates the canonical plan and sends one RPC with the exact metadata snapshot", async () => {
    const admin = client();
    expect(await fulfillPayment(admin, payment, { event: "successful" })).toEqual({
      outcome: "completed",
    });
    expect(admin.rpc).toHaveBeenCalledExactlyOnceWith("fulfill_ozow_payment", {
      p_payment_id: payment.id,
      p_provider_payment_id: "ozow-1",
      p_expected_amount: 25000,
      p_expected_metadata: payment.provider_data,
      p_plan_id: plan.id,
      p_addon_days: null,
      p_webhook: { event: "successful" },
    });
  });

  it("resolves a stable frontend plan token to the canonical database ID", async () => {
    const admin = client();
    await fulfillPayment(admin, {
      ...payment,
      provider_data: {
        ...payment.provider_data,
        plan_id: getStablePlanId("MZANSI_MARKET", "growth"),
      },
    });
    expect(admin.rpc.mock.calls[0][1].p_plan_id).toBe(plan.id);
  });

  it("accepts the canonical Basic package", async () => {
    const admin = client([{ ...plan, tier: "basic", price_cents: 3000 }]);
    await fulfillPayment(admin, {
      ...payment,
      amount_cents: 3000,
      provider_data: { ...payment.provider_data, plan_tier: "basic" },
    });
    expect(admin.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    [{ ...payment, amount_cents: 1 }, [plan], /amount/],
    [{ ...payment, area: "MZANSI_BUSINESS" }, [plan], /area/],
    [{ ...payment, provider_data: { ...payment.provider_data, plan_tier: "pro" } }, [plan], /tier/],
    [payment, [{ ...plan, active: false }], /not found or inactive/],
    [payment, [{ ...plan, price_cents: 1 }], /catalog/],
    [{ ...payment, provider_data: { type: "subscription" } }, [plan], /no plan ID/],
    [{ ...payment, provider_data: null }, [plan], /no parseable metadata/],
    [{ ...payment, user_id: null }, [plan], /no user_id/],
    [{ ...payment, provider_data: { type: "unknown" } }, [plan], /Unsupported/],
  ])("rejects invalid fulfillment input before any mutation %#", async (input, rows, error) => {
    const admin = client(rows as Array<Record<string, unknown>>);
    await expect(fulfillPayment(admin, input as PaymentRecordShape)).rejects.toThrow(
      error as RegExp
    );
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it.each(["completed", "duplicate", "recovered", "ignored"] as const)(
    "returns the database %s outcome",
    async (outcome) => {
      const admin = client();
      admin.rpc.mockResolvedValue({ data: { outcome }, error: null });
      expect(await fulfillPayment(admin, payment)).toEqual({ outcome });
    }
  );

  it.each([null, {}, { outcome: "unexpected" }])(
    "rejects an invalid/missing RPC response %#",
    async (data) => {
      const admin = client();
      admin.rpc.mockResolvedValue({ data, error: null });
      await expect(fulfillPayment(admin, payment)).rejects.toThrow(/invalid result/);
      expect(admin.rpc).toHaveBeenCalledOnce();
    }
  );

  it("never falls back to non-atomic writes if the migration is missing or the transaction fails", async () => {
    const admin = client();
    admin.rpc.mockResolvedValue({ data: null, error: { message: "function not found" } });
    await expect(fulfillPayment(admin, payment)).rejects.toThrow(/function not found/);
    expect(admin.rpc).toHaveBeenCalledOnce();
    expect(admin.from.mock.calls.every(([table]) => table === "plans")).toBe(true);
  });

  it.each(["processing", "complete", "refunded"] as const)(
    "leaves %s reconciliation to the locked database row without a new plan lookup",
    async (status) => {
      const admin = client([]);
      await fulfillPayment(admin, { ...payment, status });
      expect(admin.from).not.toHaveBeenCalled();
      expect(admin.rpc.mock.calls[0][1].p_plan_id).toBeNull();
    }
  );

  it.each([
    ["boost", BOOST_DURATION_DAYS],
    ["boost_business", BOOST_DURATION_DAYS],
    ["boost_storefront", BOOST_DURATION_DAYS],
    ["boost_promotion", BOOST_DURATION_DAYS],
    ["featured", FEATURED_DURATION_DAYS],
    ["featured_business", FEATURED_DURATION_DAYS],
    ["featured_promotion", FEATURED_DURATION_DAYS],
    ["urgent", URGENT_DURATION_DAYS],
    ["urgent_business", URGENT_DURATION_DAYS],
    ["urgent_promotion", URGENT_DURATION_DAYS],
  ])("preserves the default %s duration and nested metadata", async (type, days) => {
    const admin = client();
    const metadata = { type, listing_id: "target" };
    await fulfillPayment(admin, { ...payment, provider_data: { metadata } });
    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.rpc.mock.calls[0][1]).toMatchObject({
      p_addon_days: days,
      p_expected_metadata: metadata,
      p_plan_id: null,
    });
  });

  it.each([
    ["boost", "boost_days"],
    ["featured", "feature_days"],
    ["urgent", "urgent_days"],
  ])("preserves a purchased custom %s duration", async (type, key) => {
    const admin = client();
    await fulfillPayment(admin, { ...payment, provider_data: { type, [key]: 3 } });
    expect(admin.rpc.mock.calls[0][1].p_addon_days).toBe(3);
  });

  it("rejects a non-finite addon duration", async () => {
    const admin = client();
    await expect(
      fulfillPayment(admin, { ...payment, provider_data: { type: "boost", boost_days: Infinity } })
    ).rejects.toThrow(/Invalid addon duration/);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("server-only", () => ({}));
vi.mock("./playwright-fixture-store", () => ({
  listPlaywrightTableRows: (table: string) => structuredClone(store.tables[table] || []),
  writePlaywrightTableRows: (table: string, rows: Record<string, unknown>[]) => {
    store.tables[table] = rows;
  },
}));
import { fulfillPlaywrightPayment } from "./playwright-payment-fulfillment";

const params = {
  p_payment_id: "payment",
  p_provider_payment_id: "request",
  p_provider_transaction_id: "transaction",
  p_merchant_reference: "merchant",
  p_expected_amount: 9900,
  p_plan_id: "plan",
};

describe("Playwright transaction confirmation fixture", () => {
  beforeEach(() => {
    store.tables = {
      payments: [
        {
          id: "payment",
          provider: "ozow",
          provider_payment_id: "request",
          provider_reference: "merchant",
          amount_cents: 9900,
          status: "pending",
          user_id: "user",
          area: "market",
          created_at: "2026-10-03T00:00:00Z",
          provider_data: { metadata: { type: "subscription", area: "market", plan_tier: "plus" } },
        },
      ],
      plans: [{ id: "plan", active: true, price_cents: 9900, area: "market", tier: "plus" }],
      account_profiles: [{ user_id: "user", account_status: "active" }],
    };
  });

  it("stores the transaction separately and fulfills a signed mock purchase once", () => {
    expect(fulfillPlaywrightPayment(params, true).data?.outcome).toBe("completed");
    expect(store.tables.payments[0]).toMatchObject({
      status: "complete",
      provider_payment_id: "request",
      provider_data: { transaction_id: "transaction" },
    });
    expect(fulfillPlaywrightPayment(params, true).data?.outcome).toBe("duplicate");
    expect(store.tables.invoices).toHaveLength(1);
    expect(store.tables.entitlements).toHaveLength(1);
  });

  it.each([
    { p_provider_payment_id: "wrong-request" },
    { p_merchant_reference: "wrong-reference" },
    { p_provider_transaction_id: "" },
  ])("rejects mismatched confirmation identity before granting access: %j", (wrong) => {
    expect(fulfillPlaywrightPayment({ ...params, ...wrong }, true).error).not.toBeNull();
    expect(store.tables.payments[0].status).toBe("pending");
    expect(store.tables.invoices).toBeUndefined();
  });

  it("rejects a transaction used by another payment before granting access", () => {
    store.tables.payments.push({
      id: "other",
      provider: "ozow",
      provider_data: { transaction_id: "transaction" },
    });
    expect(fulfillPlaywrightPayment(params, true).error?.message).toBe("Transaction already used");
    expect(store.tables.invoices).toBeUndefined();
  });
});

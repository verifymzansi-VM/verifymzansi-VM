import { describe, it, expect, vi, beforeEach } from "vitest";
import { fulfillPayment } from "./fulfillment";
import { resetOwnerColumnCacheForTesting } from "@/lib/account/compat";
import { logAuditEvent } from "@/lib/services/audit";
import { getStablePlanId } from "@/lib/constants/plan-ids";

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

function createMockAdminClient(options?: {
  existingInvoice?: boolean;
  previousEntitlementStatus?: "active" | "cancelled" | null;
  planRows?: Array<Record<string, unknown>>;
}) {
  const invoiceInsert = vi.fn().mockResolvedValue({ error: null });
  const entitlementsUpsert = vi.fn().mockResolvedValue({ error: null });
  const entitlementsUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }),
  });

  const from = vi.fn((table: string) => {
    if (table === "plans") {
      const rows = options?.planRows ?? [{ id: "plan-1", tier: "growth", area: "MZANSI_MARKET" }];
      return {
        select: vi.fn().mockReturnValue({
          eq(column: string, value: unknown) {
            const filters: Array<[string, unknown]> = [[column, value]];
            const chain = {
              eq(nextColumn: string, nextValue: unknown) {
                filters.push([nextColumn, nextValue]);
                return chain;
              },
              maybeSingle: vi.fn().mockImplementation(async () => ({
                data:
                  rows.find((row) => filters.every(([key, expected]) => row[key] === expected)) ??
                  null,
              })),
            };
            return chain;
          },
        }),
      };
    }

    if (table === "entitlements") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data:
            options?.previousEntitlementStatus === undefined ||
            options?.previousEntitlementStatus === null
              ? null
              : {
                  id: "ent-prev-1",
                  status: options.previousEntitlementStatus,
                },
        }),
        upsert: entitlementsUpsert,
        update: entitlementsUpdate,
      };
    }

    if (table === "invoices") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: options?.existingInvoice ? { id: "inv-1" } : null }),
        insert: invoiceInsert,
      };
    }

    if (table === "listings" || table === "businesses" || table === "promotions") {
      return {
        select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      };
    }

    if (table === "storefronts") {
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: null }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      };
    }

    if (table === "account_profiles") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { account_status: "active" },
        }),
      };
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
  });

  return {
    client: { from },
    spies: {
      from,
      invoiceInsert,
      entitlementsUpsert,
      entitlementsUpdate,
    },
  };
}

describe("fulfillPayment invoice creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

  it("creates an invoice for subscription payments when none exists", async () => {
    const mock = createMockAdminClient({ existingInvoice: false });

    await fulfillPayment(mock.client as never, {
      id: "pay-12345678",
      user_id: "user-1",
      area: "MZANSI_MARKET",
      amount_cents: 25000,
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-123",
      provider_reference: "pay-12345678",
      provider_data: {
        type: "subscription",
        plan_id: "plan-1",
      },
      created_at: "2026-03-26T10:00:00.000Z",
    });

    expect(mock.spies.entitlementsUpsert).toHaveBeenCalledOnce();
    expect(mock.spies.invoiceInsert).toHaveBeenCalledOnce();
    expect(mock.spies.invoiceInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: "pay-12345678",
        user_id: "user-1",
        amount_cents: 21739,
        vat_cents: 3261,
        total_cents: 25000,
      })
    );
  });

  it("does not create a duplicate invoice when one already exists", async () => {
    const mock = createMockAdminClient({ existingInvoice: true });

    await fulfillPayment(mock.client as never, {
      id: "pay-87654321",
      user_id: "user-1",
      area: "MZANSI_MARKET",
      amount_cents: 25000,
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-321",
      provider_reference: "pay-87654321",
      provider_data: {
        type: "subscription",
        plan_id: "plan-1",
      },
      created_at: "2026-03-26T10:00:00.000Z",
    });

    expect(mock.spies.entitlementsUpsert).toHaveBeenCalledOnce();
    expect(mock.spies.invoiceInsert).not.toHaveBeenCalled();
  });

  it("cancels previous active entitlement for plan-change payments", async () => {
    const mock = createMockAdminClient({
      existingInvoice: false,
      previousEntitlementStatus: "active",
      planRows: [{ id: "plan-2", tier: "growth", area: "MZANSI_MARKET", active: true }],
    });

    await fulfillPayment(mock.client as never, {
      id: "pay-plan-change",
      user_id: "user-1",
      area: "MZANSI_MARKET",
      amount_cents: 30000,
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-plan-change",
      provider_reference: "pay-plan-change",
      provider_data: {
        type: "subscription",
        plan_id: "plan-2",
        is_plan_change: true,
        previous_entitlement_id: "ent-prev-1",
      },
      created_at: "2026-03-26T10:00:00.000Z",
    });

    expect(mock.spies.entitlementsUpsert).toHaveBeenCalledOnce();
    expect(mock.spies.entitlementsUpdate).toHaveBeenCalledOnce();
  });

  it("falls back from stable frontend plan tokens to the canonical database row", async () => {
    const mock = createMockAdminClient({
      planRows: [
        {
          id: "db-plan-growth",
          area: "MZANSI_MARKET",
          tier: "growth",
          name: "Mzansi Market Growth",
          price_cents: 25000,
          active: true,
        },
      ],
    });

    await fulfillPayment(mock.client as never, {
      id: "pay-stable-token",
      user_id: "user-1",
      area: "MZANSI_MARKET",
      amount_cents: 25000,
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-stable-token",
      provider_reference: "pay-stable-token",
      provider_data: {
        type: "subscription",
        plan_id: getStablePlanId("MZANSI_MARKET", "growth"),
      },
      created_at: "2026-03-26T10:00:00.000Z",
    });

    expect(mock.spies.entitlementsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        area: "MZANSI_MARKET",
        tier: "growth",
      }),
      { onConflict: "user_id,area,type" }
    );
  });

  it("supports nested provider metadata for listing boosts", async () => {
    const mock = createMockAdminClient();

    await fulfillPayment(mock.client as never, {
      id: "pay-boost-1",
      user_id: "user-1",
      area: "MZANSI_MARKET",
      amount_cents: 9900,
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-boost-1",
      provider_reference: "pay-boost-1",
      provider_data: {
        metadata: {
          type: "boost",
          listing_id: "listing-1",
          boost_days: 10,
        },
      },
      created_at: "2026-03-26T10:00:00.000Z",
    });

    expect(mock.spies.from).toHaveBeenCalledWith("listings");
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "listing_boosted",
        targetType: "listing",
        targetId: "listing-1",
      })
    );
  });

  it("rejects payments without parseable metadata", async () => {
    const mock = createMockAdminClient();

    await expect(
      fulfillPayment(mock.client as never, {
        id: "pay-no-meta",
        user_id: "user-1",
        area: "MZANSI_MARKET",
        amount_cents: 9900,
        status: "processing",
        provider: "ozow",
        provider_payment_id: "ozow-no-meta",
        provider_reference: "pay-no-meta",
        provider_data: null,
        created_at: "2026-03-26T10:00:00.000Z",
      })
    ).rejects.toThrow("Payment pay-no-meta has no parseable metadata");
  });

  it("rejects payments without a user id", async () => {
    const mock = createMockAdminClient();

    await expect(
      fulfillPayment(mock.client as never, {
        id: "pay-no-user",
        user_id: null,
        area: "MZANSI_MARKET",
        amount_cents: 9900,
        status: "processing",
        provider: "ozow",
        provider_payment_id: "ozow-no-user",
        provider_reference: "pay-no-user",
        provider_data: {
          type: "subscription",
          plan_id: "plan-1",
        },
        created_at: "2026-03-26T10:00:00.000Z",
      })
    ).rejects.toThrow("Payment pay-no-user has no user_id");
  });
});

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
  accountStatus?: "active" | "restricted";
  addonUpdateRows?: Array<Record<string, unknown>>;
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
      const rows = options?.planRows ?? [
        {
          id: "plan-1",
          tier: "growth",
          area: "MZANSI_MARKET",
          price_cents: 25000,
          active: true,
        },
      ];
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
      const updateFilter = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({
          data: options?.addonUpdateRows ?? [{ id: `${table}-1` }],
          error: null,
        }),
      };
      return {
        select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnValue(updateFilter),
      };
    }

    if (table === "storefronts") {
      const updateFilter = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({
          data: options?.addonUpdateRows ?? [{ id: "storefront-1" }],
          error: null,
        }),
      };
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: null }),
        }),
        update: vi.fn().mockReturnValue(updateFilter),
      };
    }

    if (table === "account_profiles") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { account_status: options?.accountStatus ?? "active" },
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
        plan_tier: "growth",
        area: "MZANSI_MARKET",
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
        plan_tier: "growth",
        area: "MZANSI_MARKET",
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
      planRows: [
        {
          id: "plan-2",
          tier: "growth",
          area: "MZANSI_MARKET",
          price_cents: 25000,
          active: true,
        },
      ],
    });

    await fulfillPayment(mock.client as never, {
      id: "pay-plan-change",
      user_id: "user-1",
      area: "MZANSI_MARKET",
      amount_cents: 25000,
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-plan-change",
      provider_reference: "pay-plan-change",
      provider_data: {
        type: "subscription",
        plan_id: "plan-2",
        plan_tier: "growth",
        area: "MZANSI_MARKET",
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
        plan_tier: "growth",
        area: "MZANSI_MARKET",
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

  it("fulfils the Mzansi Market Basic package", async () => {
    const mock = createMockAdminClient({
      planRows: [
        {
          id: "basic-plan",
          area: "MZANSI_MARKET",
          tier: "basic",
          name: "Mzansi Market Basic",
          price_cents: 3000,
          active: true,
        },
      ],
    });

    await fulfillPayment(mock.client as never, {
      id: "pay-basic",
      user_id: "user-1",
      area: "MZANSI_MARKET",
      amount_cents: 3000,
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-basic",
      provider_reference: "pay-basic",
      provider_data: {
        type: "subscription",
        plan_id: "basic-plan",
        plan_tier: "basic",
        area: "MZANSI_MARKET",
      },
      created_at: "2026-03-26T10:00:00.000Z",
    });

    expect(mock.spies.entitlementsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        area: "MZANSI_MARKET",
        tier: "basic",
        status: "active",
      }),
      { onConflict: "user_id,area,type" }
    );
  });

  it("keeps restricted accounts in pending_verification after payment", async () => {
    const mock = createMockAdminClient({ accountStatus: "restricted" });

    await fulfillPayment(mock.client as never, {
      id: "pay-restricted",
      user_id: "user-1",
      area: "MZANSI_MARKET",
      amount_cents: 25000,
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-restricted",
      provider_reference: "pay-restricted",
      provider_data: {
        type: "subscription",
        plan_id: "plan-1",
        plan_tier: "growth",
        area: "MZANSI_MARKET",
      },
      created_at: "2026-03-26T10:00:00.000Z",
    });

    expect(mock.spies.entitlementsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending_verification",
      }),
      { onConflict: "user_id,area,type" }
    );
  });

  it("rejects subscription fulfillment when the paid amount does not match the plan", async () => {
    const mock = createMockAdminClient();

    await expect(
      fulfillPayment(mock.client as never, {
        id: "pay-amount-mismatch",
        user_id: "user-1",
        area: "MZANSI_MARKET",
        amount_cents: 100,
        status: "processing",
        provider: "ozow",
        provider_payment_id: "ozow-amount-mismatch",
        provider_reference: "pay-amount-mismatch",
        provider_data: {
          type: "subscription",
          plan_id: "plan-1",
          plan_tier: "growth",
          area: "MZANSI_MARKET",
        },
        created_at: "2026-03-26T10:00:00.000Z",
      })
    ).rejects.toThrow("Payment amount mismatch");
  });

  it("rejects subscription fulfillment when metadata tier is tampered", async () => {
    const mock = createMockAdminClient();

    await expect(
      fulfillPayment(mock.client as never, {
        id: "pay-tier-mismatch",
        user_id: "user-1",
        area: "MZANSI_MARKET",
        amount_cents: 25000,
        status: "processing",
        provider: "ozow",
        provider_payment_id: "ozow-tier-mismatch",
        provider_reference: "pay-tier-mismatch",
        provider_data: {
          type: "subscription",
          plan_id: "plan-1",
          plan_tier: "pro",
          area: "MZANSI_MARKET",
        },
        created_at: "2026-03-26T10:00:00.000Z",
      })
    ).rejects.toThrow("metadata tier");
  });

  it("rejects inactive plans during subscription fulfillment", async () => {
    const mock = createMockAdminClient({
      planRows: [
        {
          id: "inactive-plan",
          area: "MZANSI_MARKET",
          tier: "growth",
          name: "Inactive Growth",
          price_cents: 25000,
          active: false,
        },
      ],
    });

    await expect(
      fulfillPayment(mock.client as never, {
        id: "pay-inactive-plan",
        user_id: "user-1",
        area: "MZANSI_MARKET",
        amount_cents: 25000,
        status: "processing",
        provider: "ozow",
        provider_payment_id: "ozow-inactive-plan",
        provider_reference: "pay-inactive-plan",
        provider_data: {
          type: "subscription",
          plan_id: "inactive-plan",
          plan_tier: "growth",
          area: "MZANSI_MARKET",
        },
        created_at: "2026-03-26T10:00:00.000Z",
      })
    ).rejects.toThrow("not found or inactive");
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
          plan_tier: "growth",
          area: "MZANSI_MARKET",
        },
        created_at: "2026-03-26T10:00:00.000Z",
      })
    ).rejects.toThrow("Payment pay-no-user has no user_id");
  });

  it("fulfils featured_business by setting featured_until on the business", async () => {
    const mock = createMockAdminClient();

    await fulfillPayment(mock.client as never, {
      id: "pay-feat-biz",
      user_id: "user-1",
      area: "MZANSI_BUSINESS",
      amount_cents: 2500,
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-feat-biz",
      provider_reference: "pay-feat-biz",
      provider_data: {
        metadata: {
          type: "featured_business",
          business_id: "biz-1",
          feature_days: 7,
        },
      },
      created_at: "2026-03-26T10:00:00.000Z",
    });

    expect(mock.spies.from).toHaveBeenCalledWith("businesses");
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "business_featured",
        targetType: "business",
        targetId: "biz-1",
      })
    );
  });

  it("fulfils urgent_business by setting urgent_until on the business", async () => {
    const mock = createMockAdminClient();

    await fulfillPayment(mock.client as never, {
      id: "pay-urg-biz",
      user_id: "user-1",
      area: "MZANSI_BUSINESS",
      amount_cents: 1000,
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-urg-biz",
      provider_reference: "pay-urg-biz",
      provider_data: {
        metadata: {
          type: "urgent_business",
          business_id: "biz-2",
          urgent_days: 7,
        },
      },
      created_at: "2026-03-26T10:00:00.000Z",
    });

    expect(mock.spies.from).toHaveBeenCalledWith("businesses");
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "business_urgent",
        targetType: "business",
        targetId: "biz-2",
      })
    );
  });

  it("fulfils urgent_promotion by setting urgent_until on the promotion", async () => {
    const mock = createMockAdminClient();

    await fulfillPayment(mock.client as never, {
      id: "pay-urg-promo",
      user_id: "user-1",
      area: "PROMOTIONS_EVENTS",
      amount_cents: 1000,
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-urg-promo",
      provider_reference: "pay-urg-promo",
      provider_data: {
        metadata: {
          type: "urgent_promotion",
          promotion_id: "promo-1",
          urgent_days: 7,
        },
      },
      created_at: "2026-03-26T10:00:00.000Z",
    });

    expect(mock.spies.from).toHaveBeenCalledWith("promotions");
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "promotion_urgent",
        targetType: "promotion",
        targetId: "promo-1",
      })
    );
  });

  it("rejects add-on fulfillment when the target update matches zero rows", async () => {
    const mock = createMockAdminClient({ addonUpdateRows: [] });

    await expect(
      fulfillPayment(mock.client as never, {
        id: "pay-missing-listing",
        user_id: "user-1",
        area: "MZANSI_MARKET",
        amount_cents: 9900,
        status: "processing",
        provider: "ozow",
        provider_payment_id: "ozow-missing-listing",
        provider_reference: "pay-missing-listing",
        provider_data: {
          metadata: {
            type: "boost",
            listing_id: "missing-listing",
          },
        },
        created_at: "2026-03-26T10:00:00.000Z",
      })
    ).rejects.toThrow("Boost update matched no listing");
    expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "listing_boosted" })
    );
  });
});

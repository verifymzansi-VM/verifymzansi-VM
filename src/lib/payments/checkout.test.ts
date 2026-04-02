import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHostedCheckout } from "./checkout";
import { createOzowHostedPayment, OzowAuthenticationError } from "./ozow";
import type * as OzowModuleTypes from "./ozow";

type OzowModule = typeof OzowModuleTypes;

vi.mock("./ozow", async () => {
  const actual = await vi.importActual<OzowModule>("./ozow");
  return {
    ...actual,
    createOzowHostedPayment: vi.fn(),
  };
});

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createMockAdminClient(options?: {
  insertResult?: { data: { id: string } | null; error: { message?: string } | null };
  updateResults?: Array<{ error?: { message?: string } | null }>;
}) {
  const updatePayloads: Array<Record<string, unknown>> = [];
  const insertPayloads: Array<Record<string, unknown>> = [];
  const updateResults = [...(options?.updateResults ?? [{ error: null }])];

  const from = vi.fn(() => ({
    insert: vi.fn((value: Record<string, unknown>) => {
      insertPayloads.push(value);
      return {
        select: vi.fn(() => ({
          single: vi
            .fn()
            .mockResolvedValue(
              options?.insertResult ?? { data: { id: String(value.id) }, error: null }
            ),
        })),
      };
    }),
    update: vi.fn((value: Record<string, unknown>) => {
      updatePayloads.push(value);
      return {
        eq: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue(updateResults.shift() ?? { error: null }),
        })),
      };
    }),
  }));

  return {
    client: { from },
    spies: {
      from,
      insertPayloads,
      updatePayloads,
    },
  };
}

describe("createHostedCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
  });

  it("creates a pending payment, then stores provider checkout details", async () => {
    vi.mocked(createOzowHostedPayment).mockResolvedValue({
      providerPaymentId: "ozow-payment-1",
      providerReference: "11111111111141118111111111111111",
      redirectUrl: "https://pay.ozow.test/checkout/1",
      expireAt: "2026-03-26T10:30:00.000Z",
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
      rawResponse: { id: "ozow-payment-1" },
    });
    const mock = createMockAdminClient();

    const result = await createHostedCheckout({
      admin: mock.client as never,
      userId: "user-1",
      area: "MZANSI_MARKET",
      amountCents: 25000,
      itemName: "Growth Plan",
      itemDescription: "Growth Plan monthly subscription",
      returnUrl: "https://verifymzansi.com/billing/success?payment=__PAYMENT_ID__",
      cancelUrl: "https://verifymzansi.com/billing/cancel?payment=__PAYMENT_ID__",
      providerData: { type: "subscription", plan_id: "plan-1" },
    });

    expect(result).toEqual({
      paymentId: "11111111-1111-4111-8111-111111111111",
      checkoutUrl: "https://pay.ozow.test/checkout/1",
    });
    expect(mock.spies.insertPayloads).toHaveLength(1);
    expect(mock.spies.insertPayloads[0]).toEqual(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        user_id: "user-1",
        amount_cents: 25000,
        provider_reference: "11111111111141118111111111111111",
        provider_data: expect.objectContaining({
          type: "subscription",
          plan_id: "plan-1",
          merchant_reference: "11111111111141118111111111111111",
          created_at: expect.any(String),
        }),
      })
    );
    expect(vi.mocked(createOzowHostedPayment)).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: "11111111-1111-4111-8111-111111111111",
        merchantReference: "11111111111141118111111111111111",
        returnUrl:
          "https://verifymzansi.com/billing/success?payment=11111111-1111-4111-8111-111111111111",
        cancelUrl:
          "https://verifymzansi.com/billing/cancel?payment=11111111-1111-4111-8111-111111111111",
      })
    );
    expect(mock.spies.updatePayloads).toHaveLength(1);
    expect(mock.spies.updatePayloads[0]).toEqual(
      expect.objectContaining({
        provider_payment_id: "ozow-payment-1",
        provider_reference: "11111111111141118111111111111111",
        provider_data: expect.objectContaining({
          checkout_url: "https://pay.ozow.test/checkout/1",
          expire_at: "2026-03-26T10:30:00.000Z",
          correlation_id: "corr-1",
          idempotency_key: "idem-1",
        }),
      })
    );
  });

  it("throws when the initial payment record cannot be created", async () => {
    const mock = createMockAdminClient({
      insertResult: { data: null, error: { message: "insert failed" } },
    });

    await expect(
      createHostedCheckout({
        admin: mock.client as never,
        userId: "user-1",
        area: "MZANSI_MARKET",
        amountCents: 25000,
        itemName: "Growth Plan",
        returnUrl: "https://verifymzansi.com/billing/success?payment=__PAYMENT_ID__",
        cancelUrl: "https://verifymzansi.com/billing/cancel?payment=__PAYMENT_ID__",
        providerData: { type: "subscription", plan_id: "plan-1" },
      })
    ).rejects.toThrow("Failed to create payment");

    expect(vi.mocked(createOzowHostedPayment)).not.toHaveBeenCalled();
    expect(mock.spies.updatePayloads).toHaveLength(0);
  });

  it("marks the payment as failed once when provider detail persistence fails", async () => {
    vi.mocked(createOzowHostedPayment).mockResolvedValue({
      providerPaymentId: "ozow-payment-1",
      providerReference: "11111111111141118111111111111111",
      redirectUrl: "https://pay.ozow.test/checkout/1",
      expireAt: "2026-03-26T10:30:00.000Z",
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
      rawResponse: { id: "ozow-payment-1" },
    });
    const mock = createMockAdminClient({
      updateResults: [{ error: { message: "write failed" } }, { error: null }],
    });

    await expect(
      createHostedCheckout({
        admin: mock.client as never,
        userId: "user-1",
        area: "MZANSI_MARKET",
        amountCents: 25000,
        itemName: "Growth Plan",
        returnUrl: "https://verifymzansi.com/billing/success?payment=__PAYMENT_ID__",
        cancelUrl: "https://verifymzansi.com/billing/cancel?payment=__PAYMENT_ID__",
        providerData: { type: "subscription", plan_id: "plan-1" },
      })
    ).rejects.toThrow("Failed to update payment with provider details: write failed");

    expect(mock.spies.updatePayloads).toHaveLength(2);
    expect(mock.spies.updatePayloads[1]).toEqual(
      expect.objectContaining({
        status: "failed",
        provider_data: expect.objectContaining({
          last_error: "Post-checkout update failed: write failed",
        }),
      })
    );
  });

  it("marks the payment as failed when Ozow checkout creation throws", async () => {
    vi.mocked(createOzowHostedPayment).mockRejectedValue(new Error("provider offline"));
    const mock = createMockAdminClient();

    await expect(
      createHostedCheckout({
        admin: mock.client as never,
        userId: "user-1",
        area: "MZANSI_MARKET",
        amountCents: 25000,
        itemName: "Growth Plan",
        returnUrl: "https://verifymzansi.com/billing/success?payment=__PAYMENT_ID__",
        cancelUrl: "https://verifymzansi.com/billing/cancel?payment=__PAYMENT_ID__",
        providerData: { type: "subscription", plan_id: "plan-1" },
      })
    ).rejects.toThrow("provider offline");

    expect(mock.spies.updatePayloads).toHaveLength(1);
    expect(mock.spies.updatePayloads[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        provider_data: expect.objectContaining({
          last_error: "provider offline",
        }),
      })
    );
  });

  it("stores an Ozow error code when checkout fails with a typed provider error", async () => {
    vi.mocked(createOzowHostedPayment).mockRejectedValue(
      new OzowAuthenticationError("Payment provider authentication failed")
    );
    const mock = createMockAdminClient();

    await expect(
      createHostedCheckout({
        admin: mock.client as never,
        userId: "user-1",
        area: "MZANSI_MARKET",
        amountCents: 25000,
        itemName: "Growth Plan",
        returnUrl: "https://verifymzansi.com/billing/success?payment=__PAYMENT_ID__",
        cancelUrl: "https://verifymzansi.com/billing/cancel?payment=__PAYMENT_ID__",
        providerData: { type: "subscription", plan_id: "plan-1" },
      })
    ).rejects.toThrow("Payment provider authentication failed");

    expect(mock.spies.updatePayloads).toHaveLength(1);
    expect(mock.spies.updatePayloads[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        provider_data: expect.objectContaining({
          last_error: "Payment provider authentication failed",
          last_error_code: "ozow_authentication_error",
        }),
      })
    );
  });

  it("throws a descriptive error when the inflight unique constraint is violated", async () => {
    const mock = createMockAdminClient({
      insertResult: {
        data: null,
        error: {
          message: "duplicate key value violates unique constraint",
          code: "23505",
        } as never,
      },
    });

    await expect(
      createHostedCheckout({
        admin: mock.client as never,
        userId: "user-1",
        area: "MZANSI_MARKET",
        amountCents: 25000,
        itemName: "Growth Plan",
        returnUrl: "https://verifymzansi.com/billing/success?payment=__PAYMENT_ID__",
        cancelUrl: "https://verifymzansi.com/billing/cancel?payment=__PAYMENT_ID__",
        providerData: { type: "subscription", plan_id: "plan-1" },
      })
    ).rejects.toThrow("A checkout for this area is already in progress");

    expect(vi.mocked(createOzowHostedPayment)).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockCreateAdminClient = vi.fn();
const mockFulfillPayment = vi.fn();
const mockRollbackPayment = vi.fn();
const mockSendPaymentReceiptEmail = vi.fn();
const mockSendPaymentFailedEmail = vi.fn();
const mockGetUserById = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

vi.mock("@/lib/payments/fulfillment", () => ({
  fulfillPayment: (...args: unknown[]) => mockFulfillPayment(...args),
  rollbackPaymentProcessing: (...args: unknown[]) => mockRollbackPayment(...args),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => {
    const envMap: Record<string, string> = {
      OZOW_WEBHOOK_SECRET: "webhook-secret",
    };
    return envMap[key] ?? "";
  }),
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/services/email", () => ({
  sendPaymentReceiptEmail: (...args: unknown[]) => mockSendPaymentReceiptEmail(...args),
  sendPaymentFailedEmail: (...args: unknown[]) => mockSendPaymentFailedEmail(...args),
}));

import { POST } from "./route";

function createSignedRequest(body: Record<string, unknown>, signature = "bad-signature") {
  return new NextRequest("http://localhost/api/webhooks/ozow", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "X-Ozow-Signature": signature,
    },
  });
}

describe("POST /api/webhooks/ozow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OZOW_WEBHOOK_SECRET = "webhook-secret";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    mockGetUserById.mockResolvedValue({
      data: {
        user: {
          email: "payer@example.com",
          user_metadata: { full_name: "Payer One" },
        },
      },
      error: null,
    });
    mockSendPaymentReceiptEmail.mockResolvedValue({ success: true });
    mockSendPaymentFailedEmail.mockResolvedValue({ success: true });
  });

  it("rejects webhooks when the secret is not configured", async () => {
    delete process.env.OZOW_WEBHOOK_SECRET;

    const response = await POST(
      createSignedRequest({
        eventType: "transaction.complete",
        data: { merchantReference: "payment-1", amount: "25.00", currencyCode: "ZAR" },
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Webhook secret not configured" });
  });

  it("rejects invalid signatures", async () => {
    const response = await POST(
      createSignedRequest({
        eventType: "transaction.complete",
        data: { merchantReference: "payment-1", amount: "25.00", currencyCode: "ZAR" },
      })
    );

    expect(response.status).toBe(401);
  });

  it("ignores unknown payments after successful verification", async () => {
    const crypto = await import("crypto");
    const body = {
      eventType: "transaction.complete",
      data: { merchantReference: "payment-1", amount: "25.00", currencyCode: "ZAR" },
    };
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", "webhook-secret").update(raw).digest("hex");

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      }),
    });

    const response = await POST(createSignedRequest(body, signature));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ignored).toBe(true);
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("passes promotion payment area and metadata into fulfillment after a verified completion webhook", async () => {
    const crypto = await import("crypto");
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        transactionReference: "ozow-tx-1",
        amount: "25.00",
        currencyCode: "ZAR",
      },
    };
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", "webhook-secret").update(raw).digest("hex");

    const paymentRecord = {
      id: "payment-1",
      area: "PROMOTIONS_EVENTS",
      status: "pending",
      provider: "ozow",
      provider_payment_id: null,
      provider_reference: "payment-1",
      provider_data: {
        type: "featured_promotion",
        promotion_id: "00000000-0000-0000-0000-000000000001",
        feature_days: 7,
      },
      amount_cents: 2500,
      user_id: "user-1",
    };

    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: paymentRecord })
      .mockResolvedValueOnce({ data: { ...paymentRecord, status: "processing" } })
      .mockResolvedValueOnce({
        data: {
          ...paymentRecord,
          status: "processing",
          provider_payment_id: "ozow-tx-1",
          provider_data: {
            ...paymentRecord.provider_data,
            processing_started_at: "2026-03-17T10:00:00.000Z",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          ...paymentRecord,
          status: "processing",
          provider_payment_id: "ozow-tx-1",
          provider_data: {
            ...paymentRecord.provider_data,
            processing_started_at: "2026-03-17T10:00:00.000Z",
            fulfillment_completed_at: "2026-03-17T10:00:05.000Z",
          },
        },
      });
    const paymentsSelect = {
      eq: vi.fn().mockReturnValue({
        maybeSingle,
      }),
    };
    const claimSelect = vi.fn().mockResolvedValue({ data: [{ id: "payment-1" }] });
    const claimUpdateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            neq: vi.fn().mockReturnValue({
              select: claimSelect,
            }),
          }),
        }),
      }),
    };
    const markerUpdateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    const completeUpdateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };
    const paymentsFrom = {
      select: vi.fn().mockReturnValue(paymentsSelect),
      update: vi
        .fn()
        .mockReturnValueOnce(claimUpdateChain)
        .mockReturnValueOnce(markerUpdateChain)
        .mockReturnValueOnce(completeUpdateChain),
    };

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "payments") {
          return paymentsFrom;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
    });
    mockFulfillPayment.mockResolvedValue(undefined);

    const response = await POST(createSignedRequest(body, signature));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockFulfillPayment).toHaveBeenCalledTimes(1);
    expect(mockSendPaymentReceiptEmail).toHaveBeenCalledWith(
      "payer@example.com",
      "Payer One",
      25,
      "Promotions & Events"
    );
    expect(mockFulfillPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "payment-1",
        area: "PROMOTIONS_EVENTS",
        provider_payment_id: "ozow-tx-1",
        provider_data: expect.objectContaining({
          type: "featured_promotion",
          promotion_id: "00000000-0000-0000-0000-000000000001",
          feature_days: 7,
        }),
      })
    );
  });

  it("rejects currency mismatches before fulfillment", async () => {
    const crypto = await import("crypto");
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        transactionReference: "ozow-tx-1",
        amount: "25.00",
        currencyCode: "USD",
      },
    };
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", "webhook-secret").update(raw).digest("hex");

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "payment-1",
                area: "PROMOTIONS_EVENTS",
                status: "pending",
                provider: "ozow",
                provider_payment_id: null,
                provider_reference: "payment-1",
                provider_data: {},
                amount_cents: 2500,
                user_id: "user-1",
              },
            }),
          }),
        }),
      }),
    });

    const response = await POST(createSignedRequest(body, signature));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Currency mismatch" });
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("rejects amount mismatches before fulfillment", async () => {
    const crypto = await import("crypto");
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        transactionReference: "ozow-tx-1",
        amount: "24.00",
        currencyCode: "ZAR",
      },
    };
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", "webhook-secret").update(raw).digest("hex");

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "payment-1",
                area: "PROMOTIONS_EVENTS",
                status: "pending",
                provider: "ozow",
                provider_payment_id: null,
                provider_reference: "payment-1",
                provider_data: {},
                amount_cents: 2500,
                user_id: "user-1",
              },
            }),
          }),
        }),
      }),
    });

    const response = await POST(createSignedRequest(body, signature));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Amount mismatch" });
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("marks failed Ozow events without attempting fulfillment", async () => {
    const crypto = await import("crypto");
    const body = {
      eventType: "transaction.failed",
      data: {
        merchantReference: "payment-1",
        transactionReference: "ozow-tx-1",
        amount: "25.00",
        currencyCode: "ZAR",
      },
    };
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", "webhook-secret").update(raw).digest("hex");

    const updateEqProvider = vi.fn().mockResolvedValue({ error: null });
    const updateEqId = vi.fn().mockReturnValue({ eq: updateEqProvider });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "payments") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "payment-1",
                    area: "PROMOTIONS_EVENTS",
                    status: "pending",
                    provider: "ozow",
                    provider_payment_id: null,
                    provider_reference: "payment-1",
                    provider_data: {},
                    amount_cents: 2500,
                    user_id: "user-1",
                  },
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({ eq: updateEqId }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
    });

    const response = await POST(createSignedRequest(body, signature));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockFulfillPayment).not.toHaveBeenCalled();
    expect(mockSendPaymentFailedEmail).toHaveBeenCalledWith(
      "payer@example.com",
      "Payer One",
      25,
      "Promotions & Events"
    );
  });

  it("rolls back processing when fulfillment fails after claim", async () => {
    const crypto = await import("crypto");
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        transactionReference: "ozow-tx-1",
        amount: "25.00",
        currencyCode: "ZAR",
      },
    };
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", "webhook-secret").update(raw).digest("hex");

    const paymentRecord = {
      id: "payment-1",
      area: "PROMOTIONS_EVENTS",
      status: "pending",
      provider: "ozow",
      provider_payment_id: null,
      provider_reference: "payment-1",
      provider_data: {
        type: "featured_promotion",
        promotion_id: "00000000-0000-0000-0000-000000000001",
        feature_days: 7,
      },
      amount_cents: 2500,
      user_id: "user-1",
    };

    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: paymentRecord })
      .mockResolvedValueOnce({
        data: {
          ...paymentRecord,
          status: "processing",
          provider_payment_id: "ozow-tx-1",
          provider_data: {
            ...(paymentRecord.provider_data ?? {}),
            processing_started_at: "2026-03-17T10:00:00.000Z",
          },
        },
      });
    const paymentsSelect = {
      eq: vi.fn().mockReturnValue({ maybeSingle }),
    };
    const claimSelect = vi.fn().mockResolvedValue({ data: [{ id: "payment-1" }] });
    const claimUpdateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            neq: vi.fn().mockReturnValue({
              select: claimSelect,
            }),
          }),
        }),
      }),
    };

    const rollbackUpdateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };

    const paymentsFrom = {
      select: vi.fn().mockReturnValue(paymentsSelect),
      update: vi
        .fn()
        .mockReturnValueOnce(claimUpdateChain)
        .mockReturnValueOnce(rollbackUpdateChain),
    };

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "payments") {
          return paymentsFrom;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
    });
    mockFulfillPayment.mockRejectedValue(new Error("fulfillment blew up"));
    mockRollbackPayment.mockResolvedValue(undefined);

    const response = await POST(createSignedRequest(body, signature));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Payment fulfillment failed" });
    expect(mockRollbackPayment).toHaveBeenCalledWith(expect.anything(), "payment-1");
  });

  it("finalizes a previously-fulfilled processing payment without rerunning fulfillment", async () => {
    const crypto = await import("crypto");
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        transactionReference: "ozow-tx-1",
        amount: "25.00",
        currencyCode: "ZAR",
      },
    };
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", "webhook-secret").update(raw).digest("hex");

    const processingPayment = {
      id: "payment-1",
      area: "PROMOTIONS_EVENTS",
      status: "processing",
      provider: "ozow",
      provider_payment_id: "ozow-tx-1",
      provider_reference: "payment-1",
      provider_data: {
        type: "featured_promotion",
        promotion_id: "00000000-0000-0000-0000-000000000001",
        feature_days: 7,
        processing_started_at: "2026-03-17T10:00:00.000Z",
        fulfillment_completed_at: "2026-03-17T10:00:05.000Z",
      },
      amount_cents: 2500,
      user_id: "user-1",
    };

    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: processingPayment })
      .mockResolvedValueOnce({ data: processingPayment });
    const paymentsSelect = {
      eq: vi.fn().mockReturnValue({
        maybeSingle,
      }),
    };
    const claimSelect = vi.fn().mockResolvedValue({ data: [] });
    const claimUpdateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            neq: vi.fn().mockReturnValue({
              select: claimSelect,
            }),
          }),
        }),
      }),
    };
    const completeUpdateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };
    const paymentsFrom = {
      select: vi.fn().mockReturnValue(paymentsSelect),
      update: vi
        .fn()
        .mockReturnValueOnce(claimUpdateChain)
        .mockReturnValueOnce(completeUpdateChain),
    };

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "payments") {
          return paymentsFrom;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const response = await POST(createSignedRequest(body, signature));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.recovered).toBe(true);
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });
});

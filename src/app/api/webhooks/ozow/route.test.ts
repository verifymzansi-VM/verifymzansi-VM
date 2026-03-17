import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockCreateAdminClient = vi.fn();
const mockFulfillPayment = vi.fn();
const mockRollbackPayment = vi.fn();

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

    const paymentsSelect = {
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: paymentRecord }),
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
    mockFulfillPayment.mockResolvedValue(undefined);

    const response = await POST(createSignedRequest(body, signature));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockFulfillPayment).toHaveBeenCalledTimes(1);
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
});

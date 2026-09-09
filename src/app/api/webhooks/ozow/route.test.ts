import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Webhook } from "svix";

const mockCreateAdminClient = vi.fn();
const mockFulfillPayment = vi.fn();
const mockSendPaymentReceiptEmail = vi.fn();
const mockSendPaymentFailedEmail = vi.fn();
const mockGetUserById = vi.fn();
const mockScheduleBackgroundTask = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/utils/background-task", () => ({
  scheduleBackgroundTask: (...args: unknown[]) => mockScheduleBackgroundTask(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

vi.mock("@/lib/payments/fulfillment", () => ({
  fulfillPayment: (...args: unknown[]) => mockFulfillPayment(...args),
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
      OZOW_WEBHOOK_SECRET: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
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

const webhookSecret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

function createSvixHeaders(body: Record<string, unknown>, signature?: string) {
  const raw = JSON.stringify(body);
  const webhook = new Webhook(webhookSecret);
  const timestamp = new Date();
  const webhookId = "msg_test_123";

  return {
    "Content-Type": "application/json",
    "svix-id": webhookId,
    "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
    "svix-signature": signature ?? webhook.sign(webhookId, timestamp, raw),
  };
}

function createSignedRequest(body: Record<string, unknown>, signature?: string) {
  return new NextRequest("http://localhost/api/webhooks/ozow", {
    method: "POST",
    body: JSON.stringify(body),
    headers: createSvixHeaders(body, signature),
  });
}

describe("POST /api/webhooks/ozow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFulfillPayment.mockReset().mockResolvedValue({ outcome: "completed" });
    mockCheckRateLimit.mockReset().mockResolvedValue({ limited: false });
    process.env.OZOW_WEBHOOK_SECRET = webhookSecret;
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
        data: {
          merchantReference: "payment-1",
          status: "successful",
          amount: { value: 25, currency: "ZAR" },
        },
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Webhook secret not configured" });
  });

  it("returns 401 for malformed payloads that fail webhook signature verification", async () => {
    const raw = '{"eventType":"transaction.complete",';
    const webhook = new Webhook(webhookSecret);
    const timestamp = new Date();
    const webhookId = "msg_bad_json";
    const signature = webhook.sign(webhookId, timestamp, raw);

    const response = await POST(
      new NextRequest("http://localhost/api/webhooks/ozow", {
        method: "POST",
        body: raw,
        headers: {
          "Content-Type": "application/json",
          "svix-id": webhookId,
          "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
          "svix-signature": signature,
        },
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid webhook signature" });
  });

  it("rejects invalid signatures", async () => {
    const response = await POST(
      createSignedRequest(
        {
          eventType: "transaction.complete",
          data: {
            merchantReference: "payment-1",
            status: "successful",
            amount: { value: 25, currency: "ZAR" },
          },
        },
        "v1,bad-signature"
      )
    );

    expect(response.status).toBe(401);
  });

  it("ignores unknown payments after successful verification", async () => {
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        status: "successful",
        amount: { value: 25, currency: "ZAR" },
      },
    };

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      }),
    });

    const response = await POST(createSignedRequest(body));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ignored).toBe(true);
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("returns duplicate when payment is already complete for the same provider transaction", async () => {
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        id: "ozow-tx-1",
        status: "successful",
        amount: { value: 25, currency: "ZAR" },
      },
    };

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "payment-1",
                area: "PROMOTIONS_EVENTS",
                status: "complete",
                provider: "ozow",
                provider_payment_id: "ozow-tx-1",
                provider_reference: "payment-1",
                created_at: "2026-03-26T10:00:00.000Z",
                provider_data: {},
                amount_cents: 2500,
                user_id: "user-1",
              },
            }),
          }),
        }),
      }),
      auth: { admin: { getUserById: mockGetUserById } },
    });

    const response = await POST(createSignedRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, duplicate: true });
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("rejects currency mismatches before fulfillment", async () => {
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        id: "ozow-tx-1",
        status: "successful",
        amount: { value: 25, currency: "USD" },
      },
    };

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
                created_at: "2026-03-26T10:00:00.000Z",
                provider_data: {},
                amount_cents: 2500,
                user_id: "user-1",
              },
            }),
          }),
        }),
      }),
    });

    const response = await POST(createSignedRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Currency mismatch" });
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("rejects amount mismatches before fulfillment", async () => {
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        id: "ozow-tx-1",
        status: "successful",
        amount: { value: 24, currency: "ZAR" },
      },
    };

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
                created_at: "2026-03-26T10:00:00.000Z",
                provider_data: {},
                amount_cents: 2500,
                user_id: "user-1",
              },
            }),
          }),
        }),
      }),
    });

    const response = await POST(createSignedRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Amount mismatch" });
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("marks failed Ozow transaction completions without attempting fulfillment", async () => {
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        id: "ozow-tx-1",
        status: "error",
        amount: { value: 25, currency: "ZAR" },
      },
    };

    const updateSelect = vi.fn().mockResolvedValue({ data: [{ id: "payment-1" }], error: null });
    const updateInStatus = vi.fn().mockReturnValue({ select: updateSelect });
    const updateEqProvider = vi.fn().mockReturnValue({ in: updateInStatus });
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
                    created_at: "2026-03-26T10:00:00.000Z",
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

    const response = await POST(createSignedRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(updateInStatus).toHaveBeenCalledWith("status", ["pending"]);
    expect(mockFulfillPayment).not.toHaveBeenCalled();
    expect(mockSendPaymentFailedEmail).toHaveBeenCalledWith(
      "payer@example.com",
      "Payer One",
      25,
      "Tourism & Events"
    );
  });

  it("ignores failure webhooks for already-completed payments", async () => {
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        id: "ozow-tx-late",
        status: "error",
        amount: { value: 25, currency: "ZAR" },
      },
    };

    const paymentsUpdate = vi.fn();

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
                    status: "complete",
                    provider: "ozow",
                    provider_payment_id: null,
                    provider_reference: "payment-1",
                    created_at: "2026-03-26T10:00:00.000Z",
                    provider_data: {},
                    amount_cents: 2500,
                    user_id: "user-1",
                  },
                }),
              }),
            }),
            update: paymentsUpdate,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
    });

    const response = await POST(createSignedRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, ignored: true });
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(mockFulfillPayment).not.toHaveBeenCalled();
    expect(mockSendPaymentFailedEmail).not.toHaveBeenCalled();
  });

  it("ignores error-status payloads that are missing an eventType instead of fulfilling", async () => {
    const body = {
      data: {
        merchantReference: "payment-1",
        id: "ozow-tx-1",
        status: "error",
        amount: { value: 25, currency: "ZAR" },
      },
    };

    const paymentsUpdate = vi.fn();

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
                    created_at: "2026-03-26T10:00:00.000Z",
                    provider_data: {},
                    amount_cents: 2500,
                    user_id: "user-1",
                  },
                }),
              }),
            }),
            update: paymentsUpdate,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
    });

    const response = await POST(createSignedRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, ignored: true });
    expect(mockFulfillPayment).not.toHaveBeenCalled();
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(mockSendPaymentFailedEmail).not.toHaveBeenCalled();
  });

  it("ignores successful-status payloads that are missing an eventType instead of fulfilling", async () => {
    const body = {
      data: {
        merchantReference: "payment-1",
        id: "ozow-tx-1",
        status: "successful",
        amount: { value: 25, currency: "ZAR" },
      },
    };

    const paymentsUpdate = vi.fn();

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
                    created_at: "2026-03-26T10:00:00.000Z",
                    provider_data: {},
                    amount_cents: 2500,
                    user_id: "user-1",
                  },
                }),
              }),
            }),
            update: paymentsUpdate,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
    });

    const response = await POST(createSignedRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, ignored: true });
    expect(mockFulfillPayment).not.toHaveBeenCalled();
    expect(paymentsUpdate).not.toHaveBeenCalled();
  });

  it("returns a retryable 500 when the payment lookup hits a database error", async () => {
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        id: "ozow-tx-1",
        status: "successful",
        amount: { value: 25, currency: "ZAR" },
      },
    };

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "payments") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "connection reset by peer" },
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { admin: { getUserById: mockGetUserById } },
    });

    const response = await POST(createSignedRequest(body));

    expect(response.status).toBe(500);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("keeps successful fulfillment intact when a failure callback read pending before the atomic commit", async () => {
    const payment: Record<string, unknown> = {
      id: "payment-1",
      area: "PROMOTIONS_EVENTS",
      status: "pending",
      provider: "ozow",
      provider_payment_id: null,
      provider_reference: "payment-1",
      created_at: "2026-03-26T10:00:00.000Z",
      amount_cents: 2500,
      user_id: "user-1",
      provider_data: { type: "featured_promotion", promotion_id: "promotion-1", feature_days: 7 },
    };
    let releaseFailureRead!: () => void;
    const failureReadGate = new Promise<void>((resolve) => {
      releaseFailureRead = resolve;
    });
    let capturedFailureRead!: () => void;
    const failureReadCaptured = new Promise<void>((resolve) => {
      capturedFailureRead = resolve;
    });
    let releaseFulfillment!: () => void;
    const fulfillmentGate = new Promise<void>((resolve) => {
      releaseFulfillment = resolve;
    });
    let enteredFulfillment!: () => void;
    const fulfillmentEntered = new Promise<void>((resolve) => {
      enteredFulfillment = resolve;
    });
    let firstRead = true;
    const updateRows: Record<string, unknown>[] = [];
    const client = {
      auth: { admin: { getUserById: mockGetUserById } },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              const snapshot = { ...payment };
              if (firstRead) {
                firstRead = false;
                capturedFailureRead();
                await failureReadGate;
              }
              return { data: snapshot, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const filters: Array<(row: Record<string, unknown>) => boolean> = [];
          const chain = {
            eq(column: string, value: unknown) {
              filters.push((row) => row[column] === value);
              return chain;
            },
            in(column: string, values: unknown[]) {
              filters.push((row) => values.includes(row[column]));
              return chain;
            },
            async select() {
              if (!filters.every((filter) => filter(payment))) return { data: [], error: null };
              Object.assign(payment, patch);
              updateRows.push(patch);
              return { data: [{ id: payment.id }], error: null };
            },
          };
          return chain;
        },
      }),
    };
    mockCreateAdminClient.mockReturnValue(client);
    mockFulfillPayment.mockImplementation(async () => {
      enteredFulfillment();
      await fulfillmentGate;
      payment.status = "complete";
      payment.provider_payment_id = "ozow-tx-1";
      return { outcome: "completed" };
    });
    const body = (status: string) => ({
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        id: "ozow-tx-1",
        status,
        amount: { value: 25, currency: "ZAR" },
      },
    });
    const failureRequest = POST(createSignedRequest(body("error")));
    await failureReadCaptured;
    const successRequest = POST(createSignedRequest(body("successful")));
    await fulfillmentEntered;
    releaseFulfillment();
    const successResponse = await successRequest;
    releaseFailureRead();
    const failedResponse = await failureRequest;
    expect(failedResponse.status).toBe(200);
    expect(payment.status).toBe("complete");
    expect(mockSendPaymentFailedEmail).not.toHaveBeenCalled();
    expect(successResponse.status).toBe(200);
    expect(payment.status).toBe("complete");
    expect(updateRows.some((row) => row.status === "failed")).toBe(false);
    expect(mockFulfillPayment).toHaveBeenCalledTimes(1);
    expect(mockScheduleBackgroundTask).toHaveBeenCalledWith(
      expect.any(Promise),
      "payment status email"
    );
  });
  function atomicFixture(
    status = "pending",
    providerData: Record<string, unknown> = {
      type: "featured_promotion",
      promotion_id: "promotion-1",
      feature_days: 7,
    }
  ) {
    const payment = {
      id: "payment-1",
      user_id: "user-1",
      area: "PROMOTIONS_EVENTS",
      provider: "ozow",
      status,
      provider_payment_id: null,
      provider_reference: "payment-1",
      amount_cents: 2500,
      created_at: "2026-03-26T10:00:00.000Z",
      provider_data: providerData,
    };
    const update = vi.fn();
    const client = {
      auth: { admin: { getUserById: mockGetUserById } },
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: payment, error: null }) }),
        }),
        update,
      }),
    };
    mockCreateAdminClient.mockReturnValue(client);
    const body = {
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        id: "ozow-tx-1",
        status: "successful",
        amount: { value: 25, currency: "ZAR" },
      },
    };
    return { payment, client, body, update };
  }

  it("passes the original payment status, creation date and metadata to the atomic operation", async () => {
    const fixture = atomicFixture();
    const response = await POST(createSignedRequest(fixture.body));
    expect(response.status).toBe(200);
    expect(mockFulfillPayment).toHaveBeenCalledWith(
      fixture.client,
      { ...fixture.payment, provider_payment_id: "ozow-tx-1" },
      expect.any(Object)
    );
    expect(fixture.update).not.toHaveBeenCalled();
    expect(mockScheduleBackgroundTask).toHaveBeenCalledWith(
      expect.any(Promise),
      "payment status email"
    );
  });

  it.each(["duplicate", "ignored"])(
    "acknowledges a concurrent %s result without sending another receipt",
    async (outcome) => {
      const fixture = atomicFixture();
      mockFulfillPayment.mockResolvedValue({ outcome });
      const response = await POST(createSignedRequest(fixture.body));
      expect(await response.json()).toEqual({ success: true, [outcome]: true });
      expect(mockSendPaymentReceiptEmail).not.toHaveBeenCalled();
      expect(fixture.update).not.toHaveBeenCalled();
    }
  );

  it("returns a retryable error on a transaction failure without a separate rollback write", async () => {
    const fixture = atomicFixture();
    mockFulfillPayment.mockRejectedValue(new Error("invoice unavailable"));
    const response = await POST(createSignedRequest(fixture.body));
    expect(response.status).toBe(500);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(fixture.update).not.toHaveBeenCalled();
    expect(mockSendPaymentReceiptEmail).not.toHaveBeenCalled();
  });

  it("acknowledges legacy marked recovery after the database confirms it", async () => {
    const fixture = atomicFixture("processing", {
      fulfillment_completed_at: "2026-03-26T10:01:00Z",
    });
    mockFulfillPayment.mockResolvedValue({ outcome: "recovered" });
    const response = await POST(createSignedRequest(fixture.body));
    expect(await response.json()).toEqual({ success: true, recovered: true });
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it.each(["2020-01-01T00:00:00Z", new Date().toISOString()])(
    "does not infer legacy recovery safety from processing age %s",
    async (startedAt) => {
      const fixture = atomicFixture("processing", { processing_started_at: startedAt });
      mockFulfillPayment.mockRejectedValue(new Error("Legacy payment requires reconciliation"));
      const response = await POST(createSignedRequest(fixture.body));
      expect(response.status).toBe(500);
      expect(fixture.update).not.toHaveBeenCalled();
      expect(mockSendPaymentReceiptEmail).not.toHaveBeenCalled();
    }
  );

  it("requires the successful provider transaction ID", async () => {
    const fixture = atomicFixture();
    const { id: _id, ...data } = fixture.body.data;
    const response = await POST(createSignedRequest({ ...fixture.body, data }));
    expect(response.status).toBe(400);
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("honors the rate limiter before reading or fulfilling a payment", async () => {
    const fixture = atomicFixture();
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfter: 60 });
    const response = await POST(createSignedRequest(fixture.body));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("rejects a successful callback with no amount", async () => {
    const fixture = atomicFixture();
    const { amount: _amount, ...data } = fixture.body.data;
    const response = await POST(createSignedRequest({ ...fixture.body, data }));
    expect(response.status).toBe(400);
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("rejects a substituted provider payment ID", async () => {
    const fixture = atomicFixture();
    Object.assign(fixture.payment, { provider_payment_id: "different" });
    const response = await POST(createSignedRequest(fixture.body));
    expect(response.status).toBe(400);
    expect(mockFulfillPayment).not.toHaveBeenCalled();
  });

  it("anchors receipt expiry to the same creation date used by the transaction", async () => {
    const fixture = atomicFixture("pending", { type: "subscription" });
    const response = await POST(createSignedRequest(fixture.body));
    expect(response.status).toBe(200);
    await Promise.resolve();
    expect(mockSendPaymentReceiptEmail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      25,
      expect.any(String),
      undefined,
      { kind: "subscription", expiresAt: "2026-04-25T10:00:00.000Z" }
    );
  });
});

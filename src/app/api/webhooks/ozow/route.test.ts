import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resetOzowTokenCacheForTesting } from "@/lib/payments/ozow";
import { NextRequest } from "next/server";
import { Webhook } from "svix";

const mockApplyNotification = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/foundation/billing-runtime", () => ({
  applyFoundationOzowNotification: (...args: unknown[]) => mockApplyNotification(...args),
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
      OZOW_SITE_CODE: "site-code",
      OZOW_ENV: "staging",
      OZOW_CLIENT_ID: "client-id",
      OZOW_CLIENT_SECRET: "client-secret",
      OZOW_WEBHOOK_SECRET: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
    };
    return envMap[key] ?? "";
  }),
}));

import { POST } from "./route";

const webhookSecret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

function signedRequest(raw: string, signature?: string) {
  const webhook = new Webhook(webhookSecret);
  const timestamp = new Date();
  const webhookId = "msg_test_123";
  return new NextRequest("http://localhost/api/webhooks/ozow", {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      "svix-id": webhookId,
      "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
      "svix-signature": signature ?? webhook.sign(webhookId, timestamp, raw),
    },
  });
}

const createSignedRequest = (body: Record<string, unknown>, signature?: string) =>
  signedRequest(JSON.stringify(body), signature);

const completion = {
  eventType: "transaction.complete",
  data: {
    siteCode: "site-code",
    merchantReference: "payment-1",
    id: "ozow-tx-1",
    paymentRequestId: "ozow-request-1",
    status: "successful",
    amount: { value: 25, currency: "ZAR" },
  },
};

// Production runs the foundation backend: the route authenticates and
// normalises the notification, then hands it to the foundation payment runtime
// (tested in src/lib/foundation/billing-runtime.test.ts).
describe("POST /api/webhooks/ozow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    resetOzowTokenCacheForTesting();
    vi.clearAllMocks();
    mockCheckRateLimit.mockReset().mockResolvedValue({ limited: false });
    mockApplyNotification.mockReset().mockResolvedValue({ success: true, result: "completed" });
    vi.stubEnv("OZOW_WEBHOOK_SECRET", webhookSecret);
    vi.stubEnv("NODE_ENV", "development");
  });

  it("hands a signed completion and its raw body to the foundation payment runtime", async () => {
    const raw = JSON.stringify(completion);
    const response = await POST(signedRequest(raw));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, result: "completed" });
    expect(mockApplyNotification).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        eventType: "transaction.complete",
        merchantReference: "payment-1",
        transactionId: "ozow-tx-1",
      }),
      raw
    );
  });

  it("rejects webhooks when the secret is not configured", async () => {
    vi.stubEnv("OZOW_WEBHOOK_SECRET", "");
    const response = await POST(createSignedRequest(completion));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Webhook secret not configured" });
    expect(mockApplyNotification).not.toHaveBeenCalled();
  });

  it("answers production callers without naming the missing secret", async () => {
    vi.stubEnv("OZOW_WEBHOOK_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(createSignedRequest(completion));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Ozow webhook temporarily unavailable",
    });
  });

  it("returns 401 for malformed payloads that fail webhook signature verification", async () => {
    const response = await POST(signedRequest('{"eventType":"transaction.complete",'));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid webhook signature" });
    expect(mockApplyNotification).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures", async () => {
    const response = await POST(createSignedRequest(completion, "v1,bad-signature"));
    expect(response.status).toBe(401);
    expect(mockApplyNotification).not.toHaveBeenCalled();
  });

  it("honors the rate limiter before reading or applying a notification", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfter: 60 });
    const response = await POST(createSignedRequest(completion));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(mockApplyNotification).not.toHaveBeenCalled();
  });

  it("refuses an oversized body before checking its signature", async () => {
    const response = await POST(signedRequest("x".repeat(256 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(mockApplyNotification).not.toHaveBeenCalled();
  });

  it("acknowledges and ignores event types other than transaction completion", async () => {
    const response = await POST(createSignedRequest({ ...completion, eventType: "other.event" }));
    expect(await response.json()).toEqual({ success: true, ignored: true });
    expect(mockApplyNotification).not.toHaveBeenCalled();
  });

  it.each([
    [["merchantReference", "id"], "Missing merchantReference"],
    [["status"], "Missing transaction status"],
  ])("rejects a completion without %j", async (fields, error) => {
    const data: Record<string, unknown> = { ...completion.data };
    for (const field of fields) delete data[field];
    const response = await POST(createSignedRequest({ ...completion, data }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(mockApplyNotification).not.toHaveBeenCalled();
  });

  it("resolves a signed thin notification through the transaction API first", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token", expires_in: "14400" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ozow-tx-1",
          merchantReference: "payment-1",
          siteCode: "site-code",
          amount: { value: 25, currency: "ZAR" },
          status: "Successful",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      createSignedRequest({
        type: "transaction.complete",
        data: { id: "ozow-tx-1", status: "Successful", reason: null },
      })
    );
    expect(response.status).toBe(200);
    expect(mockApplyNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantReference: "payment-1",
        rawPayload: expect.objectContaining({ resolvedTransaction: expect.any(Object) }),
      }),
      expect.any(String)
    );
  });

  it("returns a retryable error when thin transaction resolution fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    const response = await POST(
      createSignedRequest({
        type: "transaction.complete",
        data: { id: "ozow-tx-1", status: "Successful" },
      })
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(mockApplyNotification).not.toHaveBeenCalled();
  });

  it("returns a retryable error without details when the runtime fails", async () => {
    mockApplyNotification.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(createSignedRequest(completion));
    expect(response.status).toBe(500);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(await response.json()).toEqual({ error: "Webhook processing failed" });
  });
});

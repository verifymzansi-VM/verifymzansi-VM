import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMap: Record<string, string> = {
  OZOW_ENV: "staging",
  OZOW_CLIENT_ID: "client-id",
  OZOW_CLIENT_SECRET: "client-secret",
  OZOW_SITE_CODE: "site-code",
  OZOW_WEBHOOK_SECRET: "webhook-secret",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NODE_ENV: "test",
};

vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => envMap[key] ?? ""),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("ozow payments", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses the cached token until expiry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-1", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "req-1", redirectUrl: "https://pay.ozow.test/one" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "req-2", redirectUrl: "https://pay.ozow.test/two" }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const { createOzowHostedPayment, resetOzowTokenCacheForTesting } = await import("./ozow");
    resetOzowTokenCacheForTesting();

    await createOzowHostedPayment({
      paymentId: "payment-1",
      amountCents: 2500,
      itemName: "Growth Plan",
      returnUrl: "https://verifymzansi.com/billing/success?payment=payment-1",
      cancelUrl: "https://verifymzansi.com/billing/cancel?payment=payment-1",
    });

    await createOzowHostedPayment({
      paymentId: "payment-2",
      amountCents: 1500,
      itemName: "Boost Listing",
      returnUrl: "https://verifymzansi.com/billing/success?payment=payment-2",
      cancelUrl: "https://verifymzansi.com/billing/cancel?payment=payment-2",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/token");
    expect(fetchMock.mock.calls[1][0]).toContain("/payments");
    expect(fetchMock.mock.calls[2][0]).toContain("/payments");
  });

  it("builds the hosted payment request with correlation and idempotency headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-1", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "req-1", redirectUrl: "https://pay.ozow.test/one" }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const { createOzowHostedPayment, resetOzowTokenCacheForTesting } = await import("./ozow");
    resetOzowTokenCacheForTesting();

    await createOzowHostedPayment({
      paymentId: "payment-1",
      amountCents: 2500,
      itemName: "Growth Plan",
      itemDescription: "Growth plan upgrade",
      returnUrl: "https://verifymzansi.com/billing/success?payment=payment-1",
      cancelUrl: "https://verifymzansi.com/billing/cancel?payment=payment-1",
    });

    const requestOptions = fetchMock.mock.calls[1][1] as RequestInit;
    const headers = requestOptions.headers as Record<string, string>;
    const body = JSON.parse(String(requestOptions.body));

    expect(headers.Authorization).toBe("Bearer token-1");
    expect(headers["Idempotency-Key"]).toBeTruthy();
    expect(headers["X-Correlation-ID"]).toBeTruthy();
    expect(body.siteCode).toBe("site-code");
    expect(body.amount).toBe("25.00");
    expect(body.currencyCode).toBe("ZAR");
    expect(body.merchantReference).toBe("payment1");
  });

  it("verifies webhook signatures using the shared secret", async () => {
    const { verifyOzowWebhookSignature } = await import("./ozow");
    const body = JSON.stringify({ eventType: "transaction.complete" });
    const crypto = await import("crypto");
    const signature = crypto
      .createHmac("sha256", envMap.OZOW_WEBHOOK_SECRET)
      .update(body)
      .digest("hex");

    expect(verifyOzowWebhookSignature(body, signature)).toBe(true);
    expect(verifyOzowWebhookSignature(body, "bad-signature")).toBe(false);
  });

  it("normalizes transactionReference webhooks into providerPaymentId", async () => {
    const { normalizeOzowWebhook } = await import("./ozow");

    const payload = normalizeOzowWebhook({
      eventType: "transaction.complete",
      data: {
        merchantReference: "payment-1",
        transactionReference: "ozow-tx-1",
        amount: "25.00",
        currencyCode: "ZAR",
      },
    });

    expect(payload).toEqual(
      expect.objectContaining({
        merchantReference: "payment-1",
        providerPaymentId: "ozow-tx-1",
        amount: "25.00",
        currencyCode: "ZAR",
      })
    );
  });
});

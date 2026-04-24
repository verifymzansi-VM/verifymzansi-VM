import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Webhook } from "svix";

const envMap: Record<string, string> = {
  OZOW_ENV: "staging",
  OZOW_CLIENT_ID: "client-id",
  OZOW_CLIENT_SECRET: "client-secret",
  OZOW_SITE_CODE: "site-code",
  OZOW_WEBHOOK_SECRET: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
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
      merchantReference: "payment1",
      amountCents: 2500,
      returnUrl: "https://verifymzansi.com/billing/success?payment=payment-1",
      cancelUrl: "https://verifymzansi.com/billing/cancel?payment=payment-1",
    });

    await createOzowHostedPayment({
      paymentId: "payment-2",
      merchantReference: "payment2",
      amountCents: 1500,
      returnUrl: "https://verifymzansi.com/billing/success?payment=payment-2",
      cancelUrl: "https://verifymzansi.com/billing/cancel?payment=payment-2",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/token");
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain("scope=payment");
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
      merchantReference: "payment1",
      amountCents: 2500,
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
    expect(body.region).toBe("ZA");
    expect(body.amount).toEqual({ currency: "ZAR", value: 25 });
    expect(body.merchantReference).toBe("payment1");
    expect(body.beneficiaryReference).toBe("payment1");
    expect(body.payerReference).toBe("payment1");
  });

  it("throws a configuration error when the Ozow client secret is missing", async () => {
    const originalClientSecret = envMap.OZOW_CLIENT_SECRET;
    envMap.OZOW_CLIENT_SECRET = "";

    try {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const { createOzowHostedPayment, resetOzowTokenCacheForTesting } = await import("./ozow");
      resetOzowTokenCacheForTesting();

      await expect(
        createOzowHostedPayment({
          paymentId: "payment-1",
          merchantReference: "payment1",
          amountCents: 2500,
          returnUrl: "https://verifymzansi.com/billing/success?payment=payment-1",
          cancelUrl: "https://verifymzansi.com/billing/cancel?payment=payment-1",
        })
      ).rejects.toMatchObject({
        name: "OzowConfigurationError",
        code: "ozow_configuration_error",
      });

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      envMap.OZOW_CLIENT_SECRET = originalClientSecret;
    }
  });

  it("throws an authentication error when the Ozow token endpoint rejects the client", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "invalid client credentials",
    });

    vi.stubGlobal("fetch", fetchMock);

    const { createOzowHostedPayment, resetOzowTokenCacheForTesting } = await import("./ozow");
    resetOzowTokenCacheForTesting();

    await expect(
      createOzowHostedPayment({
        paymentId: "payment-1",
        merchantReference: "payment1",
        amountCents: 2500,
        returnUrl: "https://verifymzansi.com/billing/success?payment=payment-1",
        cancelUrl: "https://verifymzansi.com/billing/cancel?payment=payment-1",
      })
    ).rejects.toMatchObject({
      name: "OzowAuthenticationError",
      code: "ozow_authentication_error",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes the access token once when payment creation gets an auth failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-1", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "token expired",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-2", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "req-1", redirectUrl: "https://pay.ozow.test/recovered" }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const { createOzowHostedPayment, resetOzowTokenCacheForTesting } = await import("./ozow");
    resetOzowTokenCacheForTesting();

    const result = await createOzowHostedPayment({
      paymentId: "payment-1",
      merchantReference: "payment1",
      amountCents: 2500,
      returnUrl: "https://verifymzansi.com/billing/success?payment=payment-1",
      cancelUrl: "https://verifymzansi.com/billing/cancel?payment=payment-1",
    });

    expect(result.redirectUrl).toBe("https://pay.ozow.test/recovered");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/token");
    expect(fetchMock.mock.calls[1][0]).toContain("/v1/payments");
    expect(fetchMock.mock.calls[2][0]).toContain("/v1/token");
    expect(fetchMock.mock.calls[3][0]).toContain("/v1/payments");
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer token-1",
    });
    expect((fetchMock.mock.calls[3][1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer token-2",
    });
  });

  it("falls back to the mock checkout flow when the Ozow client is unknown outside production", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({
          code: "NotFound",
          title: "Not Found",
          detail: "Consumer could not be found for client id client-id",
        }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const { createOzowHostedPayment, resetOzowTokenCacheForTesting } = await import("./ozow");
    resetOzowTokenCacheForTesting();

    const result = await createOzowHostedPayment({
      paymentId: "payment-1",
      merchantReference: "payment1",
      amountCents: 2500,
      returnUrl: "https://verifymzansi.com/billing/success?payment=payment-1",
      cancelUrl: "https://verifymzansi.com/billing/cancel?payment=payment-1",
    });

    expect(result.providerPaymentId).toBe("mock-payment-1");
    expect(result.providerReference).toBe("payment1");
    expect(result.redirectUrl).toContain("/api/mock-ozow");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("verifies Svix webhook signatures using the shared secret", async () => {
    const { verifyOzowWebhookSignature } = await import("./ozow");
    const body = JSON.stringify({ eventType: "transaction.complete" });
    const webhook = new Webhook(envMap.OZOW_WEBHOOK_SECRET);
    const signatureId = "msg_123";
    const timestamp = new Date();
    const svixTimestamp = Math.floor(timestamp.getTime() / 1000).toString();
    const svixSignature = webhook.sign(signatureId, timestamp, body);
    const headers = new Headers({
      "svix-id": signatureId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });

    expect(verifyOzowWebhookSignature(body, headers)).toBe(true);
    expect(
      verifyOzowWebhookSignature(
        body,
        new Headers({
          "svix-id": signatureId,
          "svix-timestamp": svixTimestamp,
          "svix-signature": "v1,bad-signature",
        })
      )
    ).toBe(false);
  });

  it("normalizes full transaction webhooks into payment fields", async () => {
    const { normalizeOzowWebhook } = await import("./ozow");

    const payload = normalizeOzowWebhook({
      eventType: "transaction.complete",
      data: {
        id: "ozow-tx-1",
        merchantReference: "payment-1",
        status: "successful",
        amount: {
          currency: "ZAR",
          value: 25,
        },
      },
    });

    expect(payload).toEqual(
      expect.objectContaining({
        merchantReference: "payment-1",
        providerPaymentId: "ozow-tx-1",
        amount: "25.00",
        currencyCode: "ZAR",
        status: "successful",
      })
    );
  });

  it("accepts official production Ozow base URL", async () => {
    const { validateOzowBaseUrl } = await import("./ozow");

    expect(validateOzowBaseUrl("https://one.ozow.com/", "production")).toBe("https://one.ozow.com");
  });

  it("rejects non-Ozow hosts for production custom base URL", async () => {
    const { validateOzowBaseUrl } = await import("./ozow");

    expect(() => validateOzowBaseUrl("https://evil.example.com", "production")).toThrow(
      "OZOW_API_BASE_URL must use https://one.ozow.com in production"
    );
  });

  it("rejects non-HTTPS custom base URL", async () => {
    const { validateOzowBaseUrl } = await import("./ozow");

    expect(() => validateOzowBaseUrl("http://one.ozow.com", "staging")).toThrow(
      "approved Ozow HTTPS host"
    );
  });

  it("normalizes merchant references to Ozow-safe characters", async () => {
    const { toOzowMerchantReference, toOzowReferenceField } = await import("./ozow");

    expect(toOzowMerchantReference("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111111141118111111111111111"
    );
    expect(toOzowMerchantReference("payment-1")).toBe("payment1");
    expect(toOzowReferenceField("11111111111141118111111111111111")).toBe("11111111111141");
    expect(toOzowReferenceField("payment_1 two")).toBe("payment1 two");
  });

  it("reconstructs UUIDs from stripped merchant references", async () => {
    const { fromOzowMerchantReference } = await import("./ozow");

    expect(fromOzowMerchantReference("11111111111141118111111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(fromOzowMerchantReference("aabbccdd1122334455667788aabbccdd")).toBe(
      "aabbccdd-1122-3344-5566-7788aabbccdd"
    );
    // Non-UUID inputs return null
    expect(fromOzowMerchantReference("payment1")).toBeNull();
    expect(fromOzowMerchantReference("too-short")).toBeNull();
    expect(fromOzowMerchantReference("11111111-1111-4111-8111-111111111111")).toBeNull();
  });
});

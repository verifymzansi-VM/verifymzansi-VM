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
    vi.useRealTimers();
  });

  it("honours short string token lifetimes instead of caching them for an hour", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "short", expires_in: "120" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "request-1", redirectUrl: "https://pay.ozow.test/one" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "fresh", expires_in: "14400" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "request-2", redirectUrl: "https://pay.ozow.test/two" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { createOzowHostedPayment } = await import("./ozow");
    const input = {
      paymentId: "payment-1",
      merchantReference: "payment1",
      amountCents: 2500,
      returnUrl: "https://verifymzansi.com/billing",
      cancelUrl: "https://verifymzansi.com/billing",
    };
    await createOzowHostedPayment(input);
    vi.advanceTimersByTime(121_000);
    await createOzowHostedPayment(input);
    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/v1/token"))
    ).toHaveLength(2);
    expect((fetchMock.mock.calls[3][1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer fresh",
    });
  });

  it("keeps the full webhook reference and transaction ID separate", async () => {
    const { normalizeOzowWebhook } = await import("./ozow");
    expect(
      normalizeOzowWebhook({
        type: "transaction.complete",
        data: {
          SiteCode: "site-code",
          TransactionId: "transaction-1",
          TransactionReference: "merchant-1",
          Amount: "50.00",
          Status: "Successful",
          CurrencyCode: "ZAR",
          IsTest: "True",
        },
      })
    ).toMatchObject({
      merchantReference: "merchant-1",
      transactionId: "transaction-1",
      providerPaymentId: null,
      amount: "50.00",
      currencyCode: "ZAR",
      siteCode: "site-code",
      isTest: true,
      format: "full",
    });
  });

  it("retrieves thin transaction details from the selected One API environment", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token", expires_in: "14400" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "transaction-1",
          merchantReference: "merchant-1",
          siteCode: "site-code",
          amount: { value: 50, currency: "ZAR" },
          status: "Successful",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { getOzowTransaction } = await import("./ozow");
    expect(await getOzowTransaction("transaction-1")).toMatchObject({
      transactionId: "transaction-1",
      amount: "50",
      siteCode: "site-code",
    });
    expect(fetchMock.mock.calls[1][0].toString()).toBe(
      "https://stagingone.ozow.com/v1/transactions/transaction-1"
    );
  });

  it("follows provider pagination and supplies required inclusive date filters", async () => {
    const transaction = {
      id: "tx-1",
      merchantReference: "merchant-1",
      siteCode: "site-code",
      amount: { value: 50, currency: "ZAR" },
      status: "Successful",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token", expires_in: "14400" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [],
          links: {
            next: "https://stagingone.ozow.com/v1/payments/request-1/transactions?limit=50&offset=50&fromDate=2026-10-01&toDate=2026-10-04",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [transaction], links: { next: null } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { listOzowPaymentTransactions } = await import("./ozow");
    const result = await listOzowPaymentTransactions("request-1", "2026-10-02T08:00:00Z");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ providerPaymentId: "request-1", transactionId: "tx-1" });
    expect(fetchMock.mock.calls[1][0].toString()).toContain("fromDate=2026-10-01");
    expect(fetchMock.mock.calls[2][0].toString()).toContain("offset=50");
  });

  it("refuses pagination links that could disclose a bearer token to another host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token", expires_in: "14400" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [],
          links: { next: "https://untrusted.example/v1/transactions" },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { listOzowPaymentTransactions } = await import("./ozow");
    await expect(listOzowPaymentTransactions("request-1", "2026-10-02T08:00:00Z")).rejects.toThrow(
      "Invalid Ozow pagination link"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels the payment request without sending transaction data or a body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token", expires_in: "14400" }),
      })
      .mockResolvedValueOnce({ ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchMock);
    const { cancelOzowPaymentRequest } = await import("./ozow");
    await cancelOzowPaymentRequest("request-1");
    expect(fetchMock.mock.calls[1][0].toString()).toBe(
      "https://stagingone.ozow.com/v1/payments/request-1/cancel"
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: { "Idempotency-Key": expect.any(String) },
    });
    expect((fetchMock.mock.calls[1][1] as RequestInit).body).toBeUndefined();
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
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain("scope=payments");
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

  it("includes the provider detail on payment creation auth failures", async () => {
    const providerError = JSON.stringify({
      code: "Unauthorized",
      detail: "Consumer does not have access to the requested resource.",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-1", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => providerError,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-2", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => providerError,
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
      context: expect.objectContaining({
        status: 401,
        reason: "consumer_resource_access_denied",
        detail: "Consumer does not have access to the requested resource.",
      }),
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
  it.each([-3600, 3600])(
    "rejects correctly signed webhook timestamps outside tolerance (%s seconds)",
    async (offset) => {
      const { verifyOzowWebhookSignature } = await import("./ozow");
      const body = JSON.stringify({ type: "transaction.complete" });
      const at = new Date(Date.now() + offset * 1000);
      const signature = new Webhook(envMap.OZOW_WEBHOOK_SECRET).sign(
        "msg_timestamp_fixture",
        at,
        body
      );
      expect(
        verifyOzowWebhookSignature(
          body,
          new Headers({
            "svix-id": "msg_timestamp_fixture",
            "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
            "svix-signature": signature,
          })
        )
      ).toBe(false);
    }
  );
  it("normalizes the official full notification fixture without conflating identifiers", async () => {
    const { normalizeOzowWebhook } = await import("./ozow");
    const fixture = (await import("../../test/fixtures/contracts/ozow/full.json")).default;
    const result = normalizeOzowWebhook(fixture);
    expect(result).toMatchObject({
      format: "full",
      transactionId: fixture.data.TransactionId,
      merchantReference: fixture.data.TransactionReference,
      providerPaymentId: null,
      siteCode: "TEST-SITE",
      isTest: true,
      amount: "30.00",
      currencyCode: "ZAR",
    });
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
        transactionId: "ozow-tx-1",
        providerPaymentId: null,
        amount: "25",
        currencyCode: "ZAR",
        status: "successful",
      })
    );
  });

  it.each([
    [{ value: "25.00", currency: "ZAR" }, "25.00"],
    [{ value: 24.999, currency: "ZAR" }, "24.999"],
    [25.001, "25.001"],
    ["25.00", "25.00"],
  ])("preserves webhook amount precision for %j", async (amount, expected) => {
    const { normalizeOzowWebhook } = await import("./ozow");
    expect(normalizeOzowWebhook({ data: { amount } })?.amount).toBe(expected);
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

describe("mock checkout page (M0.8)", () => {
  const paymentId = "11111111-1111-4111-8111-111111111111";
  const input = {
    paymentId,
    merchantReference: "11111111111141118111111111111111",
    amountCents: 5000,
    returnUrl: `http://127.0.0.1:3110/billing/success?payment=${paymentId}`,
    cancelUrl: `http://127.0.0.1:3110/billing/cancel?payment=${paymentId}`,
  };
  const copy = {
    NODE_ENV: "production",
    ENVIRONMENT: "test",
    VERIFYMZANSI_RUNTIME_MODE: "e2e",
    PLAYWRIGHT_TEST_MODE: "1",
    ENABLE_MOCK_OZOW: "true",
    OZOW_ENV: "staging",
    FOUNDATION_PROJECT_REF: "local-foundation",
    FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55443",
  };
  const stub = (values: Record<string, string>) => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  };

  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is the fixed HTTPS loopback page in the foundation test copy, with no provider call", async () => {
    stub(copy);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { createOzowHostedPayment } = await import("./ozow");
    const result = await createOzowHostedPayment(input);
    const url = new URL(result.redirectUrl);
    expect(url.origin).toBe("https://127.0.0.1:55455");
    expect(url.pathname).toBe("/checkout");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      paymentId,
      amount: "50.00",
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
    });
    expect(result.providerPaymentId).toBe(`mock-${paymentId}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays on the website's own mock route outside the foundation test copy", async () => {
    stub({ ...copy, FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy", NODE_ENV: "test" });
    vi.stubGlobal("fetch", vi.fn());
    const { createOzowHostedPayment } = await import("./ozow");
    const result = await createOzowHostedPayment(input);
    expect(new URL(result.redirectUrl).origin + new URL(result.redirectUrl).pathname).toBe(
      "http://localhost:3000/api/mock-ozow"
    );
  });

  // NODE_ENV=test keeps the mock on, so only the test copy profile decides.
  it.each([
    ["ENVIRONMENT=production", { ENVIRONMENT: "production" }],
    ["ENVIRONMENT=staging", { ENVIRONMENT: "staging" }],
    ["OZOW_ENV=production", { OZOW_ENV: "production" }],
    ["another database address", { FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55441" }],
    ["no e2e runtime", { VERIFYMZANSI_RUNTIME_MODE: "" }],
  ])("is not the test copy's page with %s", async (_label, change) => {
    stub({ ...copy, NODE_ENV: "test", ...change });
    vi.stubGlobal("fetch", vi.fn());
    const { createOzowHostedPayment } = await import("./ozow");
    const result = await createOzowHostedPayment(input);
    expect(new URL(result.redirectUrl).origin + new URL(result.redirectUrl).pathname).toBe(
      "http://localhost:3000/api/mock-ozow"
    );
  });

  it.each([
    ["listOzowPaymentTransactions", "list"],
    ["getOzowPaymentRequestStatus", "status"],
    ["getOzowTransaction", "transaction"],
  ])("%s never contacts Ozow while mock Ozow is enabled", async (_name, kind) => {
    stub({ ENABLE_MOCK_OZOW: "true", NODE_ENV: "test" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ozow = await import("./ozow");
    const call =
      kind === "list"
        ? ozow.listOzowPaymentTransactions("request-1", "2026-10-02T08:00:00Z")
        : kind === "status"
          ? ozow.getOzowPaymentRequestStatus("request-1")
          : ozow.getOzowTransaction("transaction-1");
    await expect(call).rejects.toMatchObject({ code: "ozow_configuration_error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks Ozow as before with production settings, even if the mock switch leaked in", async () => {
    stub({
      ENABLE_MOCK_OZOW: "true",
      NODE_ENV: "production",
      ENVIRONMENT: "production",
      VERIFYMZANSI_RUNTIME_MODE: "e2e",
      PLAYWRIGHT_TEST_MODE: "1",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token", expires_in: "14400" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "request-1", status: "Created" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { getOzowPaymentRequestStatus, isMockOzowEnabled } = await import("./ozow");
    expect(isMockOzowEnabled()).toBe(false);
    expect(await getOzowPaymentRequestStatus("request-1")).toBe("Created");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0].toString()).toBe(
      "https://stagingone.ozow.com/v1/payments/request-1"
    );
  });
});

describe("provider lookups in the foundation test copy (M0.9c)", () => {
  const request = "mock-11111111-1111-4111-8111-111111111111";
  const copy = {
    NODE_ENV: "production",
    ENVIRONMENT: "test",
    VERIFYMZANSI_RUNTIME_MODE: "e2e",
    PLAYWRIGHT_TEST_MODE: "1",
    ENABLE_MOCK_OZOW: "true",
    OZOW_ENV: "staging",
    FOUNDATION_PROJECT_REF: "local-foundation",
    FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55443",
  };
  const stub = (values: Record<string, string>) => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  };
  const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const transaction = {
    id: "transaction-1",
    paymentRequestId: request,
    merchantReference: "a".repeat(32),
    siteCode: "site-code",
    status: "Successful",
    amount: { currency: "ZAR", value: 50 },
  };

  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks only the copy's loopback stand-in, with no token or credentials", async () => {
    stub(copy);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ results: [transaction], links: { next: null } }))
      .mockResolvedValueOnce(reply({ id: request, status: "Created" }))
      .mockResolvedValueOnce(reply(transaction));
    vi.stubGlobal("fetch", fetchMock);
    const ozow = await import("./ozow");
    const listed = await ozow.listOzowPaymentTransactions(request, "2026-10-02T08:00:00Z");
    expect(listed).toEqual([
      expect.objectContaining({
        transactionId: "transaction-1",
        providerPaymentId: request,
        status: "Successful",
        amount: "50",
        currencyCode: "ZAR",
      }),
    ]);
    expect(await ozow.getOzowPaymentRequestStatus(request)).toBe("Created");
    expect((await ozow.getOzowTransaction("transaction-1")).transactionId).toBe("transaction-1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.map((url) => url.origin)).toEqual(Array(3).fill("http://127.0.0.1:55448"));
    expect(urls.map((url) => url.pathname)).toEqual([
      `/v1/payments/${request}/transactions`,
      `/v1/payments/${request}`,
      "/v1/transactions/transaction-1",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ method: "GET", redirect: "manual" });
      expect(init.headers).toBeUndefined();
      expect(init.credentials).toBeUndefined();
    }
  });

  it.each([
    ["to Ozow", `https://one.ozow.com/v1/payments/${request}/transactions?offset=50`],
    ["off the provider API", "http://127.0.0.1:55448/admin?offset=50"],
    [
      "to the copy's database gateway",
      `http://127.0.0.1:55443/v1/payments/${request}/transactions`,
    ],
    ["to another name for loopback", `http://localhost:55448/v1/payments/${request}/transactions`],
  ])("refuses a pagination link that leaves the stand-in's API (%s)", async (_label, next) => {
    stub(copy);
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ results: [], links: { next } }));
    vi.stubGlobal("fetch", fetchMock);
    const { listOzowPaymentTransactions } = await import("./ozow");
    await expect(
      listOzowPaymentTransactions(request, "2026-10-02T08:00:00Z")
    ).rejects.toMatchObject({ code: "ozow_provider_error" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never follows a stand-in redirect and reports it as a provider failure", async () => {
    stub(copy);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 302,
      type: "basic",
      headers: new Headers({ Location: "https://one.ozow.com/v1/payments/request-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getOzowPaymentRequestStatus } = await import("./ozow");
    await expect(getOzowPaymentRequestStatus(request)).rejects.toMatchObject({
      code: "ozow_provider_error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("reports a stand-in failure as a provider failure", async () => {
    stub(copy);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }));
    const { getOzowPaymentRequestStatus } = await import("./ozow");
    await expect(getOzowPaymentRequestStatus(request)).rejects.toMatchObject({
      code: "ozow_provider_error",
      context: { status: 503 },
    });
  });

  // NODE_ENV=test keeps mock Ozow on, so only the test copy profile decides.
  it.each([
    ["ENVIRONMENT=production", { ENVIRONMENT: "production" }],
    ["ENVIRONMENT=staging", { ENVIRONMENT: "staging" }],
    ["OZOW_ENV=production", { OZOW_ENV: "production" }],
    ["another database address", { FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55441" }],
    ["no e2e runtime", { VERIFYMZANSI_RUNTIME_MODE: "" }],
    ["no browser test mode", { PLAYWRIGHT_TEST_MODE: "" }],
  ])("asks nobody in mock mode outside the test copy (%s)", async (_label, change) => {
    stub({ ...copy, NODE_ENV: "test", ...change });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ozow = await import("./ozow");
    expect(ozow.isMockOzowEnabled()).toBe(true);
    await expect(ozow.getOzowPaymentRequestStatus(request)).rejects.toMatchObject({
      code: "ozow_configuration_error",
    });
    await expect(
      ozow.listOzowPaymentTransactions(request, "2026-10-02T08:00:00Z")
    ).rejects.toMatchObject({ code: "ozow_configuration_error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks Ozow as before with production settings, even with every test switch leaked in", async () => {
    stub({ ...copy, ENVIRONMENT: "production" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ access_token: "token", expires_in: "14400" }))
      .mockResolvedValueOnce(reply({ id: "request-1", status: "Created" }));
    vi.stubGlobal("fetch", fetchMock);
    const { getOzowPaymentRequestStatus, isMockOzowEnabled } = await import("./ozow");
    expect(isMockOzowEnabled()).toBe(false);
    expect(await getOzowPaymentRequestStatus("request-1")).toBe("Created");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://stagingone.ozow.com/v1/token",
      "https://stagingone.ozow.com/v1/payments/request-1",
    ]);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer token");
  });
});

describe("notice signing headers and the test-mode flag (M3.2)", () => {
  const headers = (values: Record<string, string>) => new Headers(values);
  const svix = { "svix-id": "msg_1", "svix-timestamp": "1700000000", "svix-signature": "v1,abc" };
  const standard = {
    "webhook-id": "msg_1",
    "webhook-timestamp": "1700000000",
    "webhook-signature": "v1,abc",
  };
  const read = { id: "msg_1", timestamp: "1700000000", signature: "v1,abc" };

  it.each([
    ["svix-*", svix],
    ["webhook-*", standard],
    ["both, agreeing", { ...svix, ...standard }],
  ])("reads one complete set: %s", async (_label, values) => {
    const { readOzowSignatureHeaders } = await import("./ozow");
    expect(readOzowSignatureHeaders(headers(values))).toEqual(read);
  });

  it.each([
    ["no headers", {}],
    ["an incomplete set", { "svix-id": "msg_1", "svix-timestamp": "1700000000" }],
    [
      "parts of each style",
      { "svix-id": "msg_1", "webhook-timestamp": "1700000000", "webhook-signature": "v1,abc" },
    ],
    ["styles that disagree", { ...svix, "webhook-signature": "v1,other" }],
    ["a stray header that disagrees", { ...standard, "svix-id": "msg_2" }],
  ])("refuses %s", async (_label, values) => {
    const { readOzowSignatureHeaders } = await import("./ozow");
    expect(readOzowSignatureHeaders(headers(values))).toBeNull();
  });

  it.each([
    [{ IsTest: "True" }, true],
    [{ IsTest: "false" }, false],
    [{ isTest: true }, true],
    [{ isTest: false }, false],
    [{ isTest: "FALSE" }, false],
    [{ IsTest: "False", isTest: false }, false],
    // Absent: Ozow's published One API transaction has no flag.
    [{}, null],
    // Present but unreadable or contradictory: treated as a test outside full
    // notices (which must carry a clear flag; see the next test).
    [{ isTest: "no" }, true],
    [{ isTest: 0 }, true],
    [{ isTest: null }, true],
    [{ IsTest: "True", isTest: false }, true],
    [{ IsTest: "False", isTest: "maybe" }, true],
  ])("reads the test-mode flag %j as %s", async (flag, expected) => {
    const { normalizeOzowWebhook } = await import("./ozow");
    const payload = normalizeOzowWebhook({
      type: "transaction.complete",
      data: { id: "transaction-1", merchantReference: "merchant-1", ...flag },
    });
    expect(payload?.isTest).toBe(expected);
  });

  it.each([{ IsTest: "invalid" }, { IsTest: "True", isTest: false }])(
    "reads an unclear flag on a full notice %j as missing",
    async (flag) => {
      const { normalizeOzowWebhook } = await import("./ozow");
      const payload = normalizeOzowWebhook({
        type: "transaction.complete",
        data: { TransactionId: "transaction-1", TransactionReference: "merchant-1", ...flag },
      });
      expect(payload).toMatchObject({ format: "full", isTest: null });
    }
  );
});

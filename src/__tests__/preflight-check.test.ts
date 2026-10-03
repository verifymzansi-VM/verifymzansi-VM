import { describe, expect, it, vi } from "vitest";
import {
  checkOzowPaymentApiAccess,
  classifyOzowPreflightCheck,
  classifySupabaseSchemaPreflightError,
  retryWithBackoff,
  withTimeout,
} from "../../scripts/preflight-check";

describe("preflight-check", () => {
  it.each([
    "https://example.com",
    "http://one.ozow.com",
    "https://stagingone.ozow.com",
    "https://user:password@one.ozow.com",
    "https://one.ozow.com/path",
    "https://one.ozow.com?proxy=1",
  ])(
    "rejects a mismatched credential destination before fetching: %s",
    async (configuredBaseUrl) => {
      const fetchImpl = vi.fn<typeof fetch>();
      await expect(
        checkOzowPaymentApiAccess({
          ozowEnv: "production",
          clientId: "fixture-client",
          clientSecret: "fixture-secret",
          siteCode: "fixture-site",
          configuredBaseUrl,
          fetchImpl,
        })
      ).rejects.toThrow("official HTTPS origin");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );
  it("downgrades transient Supabase connectivity failures to warnings outside production", () => {
    const result = classifySupabaseSchemaPreflightError(
      "development",
      new TypeError("fetch failed")
    );

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("could not reach Supabase");
    expect(result.detail).toContain("pnpm preflight:prod");
  });

  it("keeps transient Supabase connectivity failures blocking in production", () => {
    const result = classifySupabaseSchemaPreflightError(
      "production",
      new TypeError("fetch failed")
    );

    expect(result.status).toBe("fail");
    expect(result.detail).toBe("fetch failed");
  });

  it("keeps non-connectivity schema failures blocking in development", () => {
    const result = classifySupabaseSchemaPreflightError(
      "development",
      new Error("businesses [PGRST205] relation does not exist")
    );

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("PGRST205");
  });

  it("fails production Ozow validation when env is not production", () => {
    const result = classifyOzowPreflightCheck({
      mode: "production",
      ozowEnv: "staging",
      clientId: "client-id",
      clientSecret: "client-secret",
      siteCode: "site-code",
      webhookSecret: "webhook-secret",
    });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("OZOW_ENV");
  });

  it("passes production Ozow validation when required values are present", () => {
    const result = classifyOzowPreflightCheck({
      mode: "production",
      ozowEnv: "production",
      clientId: "client-id",
      clientSecret: "client-secret",
      siteCode: "site-code",
      webhookSecret: "webhook-secret",
    });

    expect(result.status).toBe("pass");
    expect(result.detail).toContain("site-code");
    expect(result.detail).toContain("scope=payments");
  });

  it("fails production Ozow validation when the payment scope is singular", () => {
    const result = classifyOzowPreflightCheck({
      mode: "production",
      ozowEnv: "production",
      clientId: "client-id",
      clientSecret: "client-secret",
      siteCode: "site-code",
      webhookSecret: "webhook-secret",
      paymentScope: "payment",
    });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("OZOW_PAYMENT_OAUTH_SCOPE");
  });

  it("passes the live Ozow access check when token and site access succeed", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-1", expires_in: "14400" }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));

    const result = await checkOzowPaymentApiAccess({
      ozowEnv: "production",
      clientId: "client-id",
      clientSecret: "client-secret",
      siteCode: "site-code",
      fetchImpl,
    });

    expect(result.status).toBe("pass");
    expect(result.detail).toContain("site-code");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe("error");
    expect(fetchImpl.mock.calls[1]?.[1]?.redirect).toBe("error");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("/v1/paymentmethods");
  });

  it("fails the live Ozow access check when the OAuth consumer is not linked to the site", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-1", expires_in: "14400" }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "Unauthorized",
            detail: "Consumer does not have access to the requested resource.",
          }),
          { status: 401 }
        )
      );

    const result = await checkOzowPaymentApiAccess({
      ozowEnv: "production",
      clientId: "client-id",
      clientSecret: "client-secret",
      siteCode: "site-code",
      fetchImpl,
    });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("not authorized");
    expect(result.detail).toContain("OZOW_CLIENT_ID");
  });

  it("fails the live Ozow access check when token creation is rejected", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "Unauthorized",
          detail: "invalid client credentials",
        }),
        { status: 401 }
      )
    );

    const result = await checkOzowPaymentApiAccess({
      ozowEnv: "production",
      clientId: "client-id",
      clientSecret: "client-secret",
      siteCode: "site-code",
      fetchImpl,
    });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("token request failed");
    expect(result.detail).toContain("invalid client credentials");
  });

  it("resolves withTimeout when promise settles before deadline", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50, "fast-check")).resolves.toBe("ok");
  });

  it("rejects withTimeout when promise exceeds deadline", async () => {
    const never = new Promise<string>(() => {
      // Intentionally unresolved
    });

    await expect(withTimeout(never, 20, "slow-check")).rejects.toThrow(
      "slow-check timed out after 20ms"
    );
  });

  it("retries with backoff and eventually succeeds", async () => {
    const task = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error("attempt-1"))
      .mockResolvedValueOnce("done");

    await expect(retryWithBackoff(task, { maxAttempts: 2, baseDelayMs: 1 })).resolves.toBe("done");
    expect(task).toHaveBeenNthCalledWith(1, 1);
    expect(task).toHaveBeenNthCalledWith(2, 2);
  });

  it("throws after exhausting retryWithBackoff attempts", async () => {
    const task = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValue(new Error("still failing"));

    await expect(retryWithBackoff(task, { maxAttempts: 2, baseDelayMs: 1 })).rejects.toThrow(
      "still failing"
    );
    expect(task).toHaveBeenCalledTimes(2);
  });
});

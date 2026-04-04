import { describe, expect, it, vi } from "vitest";
import {
  classifyOzowPreflightCheck,
  classifySupabaseSchemaPreflightError,
  retryWithBackoff,
  withTimeout,
} from "../../scripts/preflight-check";

describe("preflight-check", () => {
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

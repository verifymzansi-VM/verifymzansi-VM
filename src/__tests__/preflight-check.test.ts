import { describe, expect, it } from "vitest";
import {
  classifyPayFastPreflightCheck,
  classifySupabaseSchemaPreflightError,
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

  it("fails production PayFast validation when sandbox mode is enabled", () => {
    const result = classifyPayFastPreflightCheck({
      mode: "production",
      sandbox: "true",
      merchantId: "10000100",
      merchantKey: "merchant-key",
      passphrase: "passphrase",
    });

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("PAYFAST_SANDBOX");
  });

  it("passes production PayFast validation when sandbox mode is disabled", () => {
    const result = classifyPayFastPreflightCheck({
      mode: "production",
      sandbox: "false",
      merchantId: "10000100",
      merchantKey: "merchant-key",
      passphrase: "passphrase",
    });

    expect(result.status).toBe("pass");
    expect(result.detail).toContain("sandbox=false");
  });
});

import { describe, expect, it } from "vitest";
import {
  classifyOzowPreflightCheck,
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
});

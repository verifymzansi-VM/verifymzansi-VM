import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

describe("verification fixture deployment boundaries", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["prepare_kyc", "snapshot", "claim", "set_risk"])(
    "rejects %s in production even with all test flags",
    async (action) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ENVIRONMENT", "production");
      vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "e2e");
      vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");
      vi.stubEnv("PLAYWRIGHT_SUPABASE_MODE", "stub");
      const response = await POST(
        new NextRequest("http://localhost/api/e2e/verification", {
          method: "POST",
          body: JSON.stringify({
            action,
            persona: "kyc-reviewer-desktop",
            stepId: crypto.randomUUID(),
          }),
          headers: { "Content-Type": "application/json" },
        })
      );
      expect(response.status).toBe(404);
    }
  );
  it("rejects a remote host in an explicit synthetic runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENVIRONMENT", "test");
    vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "e2e");
    vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");
    vi.stubEnv("PLAYWRIGHT_SUPABASE_MODE", "stub");
    const response = await POST(
      new NextRequest("https://verifymzansi.com/api/e2e/verification", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(response.status).toBe(404);
  });
});

/** @vitest-environment node */
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);

afterEach(() => vi.unstubAllEnvs());

it("synthetic browser startup replaces inherited database and limiter authority", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://production.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-fixture");
  vi.stubEnv("OTP_RATE_LIMITER_URL", "https://limiter.example");
  vi.stubEnv("RATE_LIMITER_API_KEY", "private-fixture");
  vi.stubEnv("ENVIRONMENT", "production");
  const { createDeterministicEnv } = require("../../scripts/start-playwright-server.cjs") as {
    createDeterministicEnv: () => Record<string, string | undefined>;
  };
  const env = createDeterministicEnv();
  expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://playwright.supabase.stub");
  expect(env.SUPABASE_SERVICE_ROLE_KEY).not.toBe("private-fixture");
  expect(env.OTP_RATE_LIMITER_URL).toBeUndefined();
  expect(env.RATE_LIMITER_API_KEY).toBeUndefined();
  expect(env.ENVIRONMENT).toBe("test");
  expect(env.VERIFYMZANSI_RUNTIME_MODE).toBe("e2e");
});

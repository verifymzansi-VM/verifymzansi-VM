import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetEnvCacheForTesting, validateEnv } from "@/lib/config/env";
import {
  resolveLaunchValidationMode,
  validateLaunchConfiguration,
} from "@/lib/config/launch-validation";

const originalEnv = { ...process.env };

function applyEnv(overrides: Record<string, string | undefined>) {
  process.env = {
    ...originalEnv,
    ...overrides,
  };
}

const validProductionEnv: Record<string, string> = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value-that-is-long-enough",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-that-is-long-enough", // secret-scan: allow deterministic fixture
  NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  AFRICASTALKING_API_KEY: "africas-talking-api-key",
  AFRICASTALKING_USERNAME: "verifymzansi",
  AFRICASTALKING_SENDER_ID: "VERIFYMZ",
  PAYFAST_MERCHANT_ID: "merchant-id",
  PAYFAST_MERCHANT_KEY: "merchant-key",
  PAYFAST_PASSPHRASE: "merchant-passphrase", // secret-scan: allow deterministic fixture
  PAYFAST_SANDBOX: "false",
  RESEND_API_KEY: "re_live_123456789",
  R2_ACCOUNT_ID: "account-12345678",
  R2_ACCESS_KEY_ID: "access-key-12345678",
  R2_SECRET_ACCESS_KEY: "secret-key-12345678",
  R2_PUBLIC_BUCKET: "verifymzansi-public",
  R2_PRIVATE_BUCKET: "verifymzansi-private",
  KYC_ENCRYPTION_KEY: "ab".repeat(32),
  ID_ENCRYPTION_KEY: "cd".repeat(32),
  HMAC_SECRET: "ef".repeat(32),
  IP_HASH_SECRET: "x".repeat(32),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key",
  TURNSTILE_SECRET_KEY: "secret-key", // secret-scan: allow deterministic fixture
};

describe("launch env validation", () => {
  beforeEach(() => {
    _resetEnvCacheForTesting();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    _resetEnvCacheForTesting();
    process.env = { ...originalEnv };
    vi.unstubAllEnvs();
  });

  it("detects playwright e2e mode from env", () => {
    expect(resolveLaunchValidationMode({ PLAYWRIGHT_TEST_MODE: "1" })).toBe("e2e");
  });

  it("fails launch validation when production secrets still look like placeholders", () => {
    const summary = validateLaunchConfiguration({
      ...validProductionEnv,
      RESEND_API_KEY: "your-value-here",
    });

    expect(summary.isValid).toBe(false);
    expect(summary.errors.some((error) => error.name === "Production secrets")).toBe(true);
  });

  it("accepts a valid strict production env", () => {
    applyEnv(validProductionEnv);

    const env = validateEnv({ strict: true, mode: "production" });

    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://verifymzansi.com");
    expect(env.R2_PUBLIC_BUCKET).toBe("verifymzansi-public");
  });

  it("fails fast on invalid production app urls", () => {
    applyEnv({
      ...validProductionEnv,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });

    expect(() => validateEnv({ strict: true, mode: "production" })).toThrow(
      /Production app URL must be public HTTPS/
    );
  });
});

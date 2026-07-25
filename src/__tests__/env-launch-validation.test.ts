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
  AFRICASTALKING_SENDER_ID: "verifymzansi",
  OZOW_ENV: "production",
  OZOW_CLIENT_ID: "client-id",
  OZOW_CLIENT_SECRET: "client-secret", // secret-scan: allow deterministic fixture
  OZOW_SITE_CODE: "site-code",
  OZOW_WEBHOOK_SECRET: "webhook-secret", // secret-scan: allow deterministic fixture
  KYC_PROVIDER: "veriff",
  KYC_WEBHOOK_SECRET: "kyc-webhook-secret", // secret-scan: allow deterministic fixture
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

  it("fails launch validation when Ozow production credentials are missing", () => {
    const summary = validateLaunchConfiguration({
      ...validProductionEnv,
      OZOW_CLIENT_SECRET: undefined,
    });

    expect(summary.isValid).toBe(false);
    expect(summary.errors).toContainEqual(
      expect.objectContaining({
        name: "Launch env",
      })
    );
    expect(summary.errors).toContainEqual(
      expect.objectContaining({
        name: "Ozow",
      })
    );
  });

  it("fails launch validation when KYC provider is still stub in production", () => {
    const summary = validateLaunchConfiguration({
      ...validProductionEnv,
      KYC_WEBHOOK_SECRET: undefined,
      KYC_PROVIDER: "stub",
    });

    expect(summary.isValid).toBe(false);
    expect(summary.errors).toContainEqual(
      expect.objectContaining({
        name: "KYC provider",
        status: "fail",
      })
    );
  });

  it("fails launch validation when KYC provider is non-stub and KYC webhook secret is missing", () => {
    const summary = validateLaunchConfiguration({
      ...validProductionEnv,
      KYC_WEBHOOK_SECRET: undefined,
      KYC_PROVIDER: "veriff",
    });

    expect(summary.isValid).toBe(false);
    expect(summary.errors).toContainEqual(
      expect.objectContaining({
        name: "Launch env",
        detail: expect.stringContaining("KYC_WEBHOOK_SECRET"),
      })
    );
    expect(summary.errors).toContainEqual(
      expect.objectContaining({
        name: "KYC webhook",
      })
    );
  });

  it("fails launch validation when Ozow is still pointed at staging", () => {
    const summary = validateLaunchConfiguration({
      ...validProductionEnv,
      OZOW_ENV: "staging",
    });

    expect(summary.isValid).toBe(false);
    expect(summary.errors).toContainEqual(
      expect.objectContaining({
        name: "Ozow",
        detail: "OZOW_ENV must be set to production for live checkout",
      })
    );
  });

  it("accepts a valid strict production env", () => {
    applyEnv(validProductionEnv);

    const env = validateEnv({ strict: true, mode: "production" });

    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://verifymzansi.com");
    expect(env.R2_PUBLIC_BUCKET).toBe("verifymzansi-public");
  });

  it("treats empty optional binary flags as unset", () => {
    applyEnv({
      ...validProductionEnv,
      PLAYWRIGHT_E2E_AUTH: "",
      STRICT_ENV_STARTUP_BLOCK: "",
    });

    const env = validateEnv({ strict: true, mode: "production" });

    expect(env.PLAYWRIGHT_E2E_AUTH).toBeUndefined();
    expect(env.STRICT_ENV_STARTUP_BLOCK).toBeUndefined();
  });

  it("requires S3-compatible R2 credentials in production when bucket names alone are set", () => {
    const bucketNamesOnlyEnv = {
      ...validProductionEnv,
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_PRIVATE_BUCKET: "verifymzansi-private",
      R2_PUBLIC_BUCKET: "verifymzansi-public",
    };

    const summary = validateLaunchConfiguration(bucketNamesOnlyEnv, { mode: "production" });

    expect(summary.isValid).toBe(false);
    expect(summary.errors).toContainEqual(
      expect.objectContaining({
        name: "R2 storage",
        status: "fail",
      })
    );
  });

  it("accepts production launch validation with native R2 bindings and no S3 credentials", () => {
    const fakeR2Bucket = {
      put: async () => ({}),
      get: async () => null,
      delete: async () => undefined,
    };
    const nativeBindingEnv = {
      ...validProductionEnv,
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_PRIVATE_BUCKET: "verifymzansi-private",
      R2_PUBLIC_BUCKET: "verifymzansi-public",
      PRIVATE_BUCKET: fakeR2Bucket,
      PUBLIC_BUCKET: fakeR2Bucket,
    } as unknown as Record<string, string>;

    const summary = validateLaunchConfiguration(nativeBindingEnv, { mode: "production" });

    expect(summary.isValid).toBe(true);
    expect(summary.errors).not.toContainEqual(
      expect.objectContaining({
        name: "R2 storage",
      })
    );
    expect(summary.checks).toContainEqual(
      expect.objectContaining({
        name: "R2 storage",
        status: "pass",
      })
    );
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

  it("fails strict production env validation when KYC_PROVIDER is non-stub and the webhook secret is missing", () => {
    applyEnv({
      ...validProductionEnv,
      KYC_PROVIDER: "veriff",
      KYC_WEBHOOK_SECRET: undefined,
    });

    expect(() => validateEnv({ strict: true, mode: "production" })).toThrow(/KYC_WEBHOOK_SECRET/);
  });
});

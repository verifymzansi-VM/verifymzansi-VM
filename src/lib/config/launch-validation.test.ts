import { describe, expect, it } from "vitest";
import {
  resolveLaunchValidationMode,
  validateLaunchConfiguration,
  type EnvSource,
} from "./launch-validation";

const BASE_ENV: EnvSource = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value-1234567890",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-1234567890", // secret-scan: allow deterministic fixture
  NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  AFRICASTALKING_API_KEY: "africas-talking-key",
  AFRICASTALKING_USERNAME: "verifymzansi",
  AFRICASTALKING_SENDER_ID: "verifymzansi",
  OZOW_ENV: "production",
  OZOW_CLIENT_ID: "client-id-value",
  OZOW_CLIENT_SECRET: "client-secret-value", // secret-scan: allow deterministic fixture
  OZOW_SITE_CODE: "site-code",
  OZOW_WEBHOOK_SECRET: "webhook-secret-value", // secret-scan: allow deterministic fixture
  KYC_WEBHOOK_SECRET: "kyc-webhook-secret-value", // secret-scan: allow deterministic fixture
  RESEND_API_KEY: "re_test_1234567890",
  R2_ACCOUNT_ID: "cloudflare-account-id",
  R2_ACCESS_KEY_ID: "cloudflare-access-key",
  R2_SECRET_ACCESS_KEY: "cloudflare-secret-key",
  KYC_ENCRYPTION_KEY: "a".repeat(64),
  ID_ENCRYPTION_KEY: "b".repeat(64),
  HMAC_SECRET: "c".repeat(64),
  IP_HASH_SECRET: "p".repeat(32),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA_test_site_key",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA_test_secret_key", // secret-scan: allow deterministic fixture
  NODE_ENV: "production",
};

describe("launch validation", () => {
  it("resolves e2e mode ahead of NODE_ENV when Playwright is driving the app", () => {
    expect(
      resolveLaunchValidationMode({
        NODE_ENV: "production",
        PLAYWRIGHT_TEST_MODE: "1",
      })
    ).toBe("e2e");
  });

  it("accepts localhost app URLs in e2e mode", () => {
    const summary = validateLaunchConfiguration(
      {
        ...BASE_ENV,
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
        OZOW_ENV: "staging",
        AFRICASTALKING_USERNAME: "sandbox",
      },
      { mode: "e2e" }
    );

    expect(summary.isValid).toBe(true);
    expect(summary.errors).toHaveLength(0);
  });

  it("fails production mode when the public app URL is not HTTPS", () => {
    const summary = validateLaunchConfiguration(
      {
        ...BASE_ENV,
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      },
      { mode: "production" }
    );

    expect(summary.isValid).toBe(false);
    expect(summary.errors.some((error) => error.name === "App URL")).toBe(true);
  });

  it("fails production mode when dev-only flags are enabled", () => {
    const summary = validateLaunchConfiguration(
      {
        ...BASE_ENV,
        ENABLE_DEV_PAYMENT_BYPASS: "true",
      },
      { mode: "production" }
    );

    expect(summary.isValid).toBe(false);
    expect(summary.errors.some((error) => error.name === "Dev-only flags")).toBe(true);
  });

  it("fails production mode when the Africa's Talking sender ID is invalid", () => {
    const summary = validateLaunchConfiguration(
      {
        ...BASE_ENV,
        AFRICASTALKING_SENDER_ID: "verify_mzansi",
      },
      { mode: "production" }
    );

    expect(summary.isValid).toBe(false);
    expect(summary.errors).toContainEqual(
      expect.objectContaining({
        name: "Africa's Talking",
        detail: "AFRICASTALKING_SENDER_ID must be 1-12 alphanumeric characters",
      })
    );
  });

  it("fails production mode when the local KYC webhook bypass is enabled", () => {
    const summary = validateLaunchConfiguration(
      {
        ...BASE_ENV,
        ENABLE_DEV_KYC_WEBHOOK_BYPASS: "true",
      },
      { mode: "production" }
    );

    expect(summary.isValid).toBe(false);
    expect(summary.errors.some((error) => error.name === "Dev-only flags")).toBe(true);
  });

  it("fails production mode when OZOW_API_BASE_URL is set to a non-official host", () => {
    const summary = validateLaunchConfiguration(
      {
        ...BASE_ENV,
        OZOW_API_BASE_URL: "https://proxy.example.com",
      },
      { mode: "production" }
    );

    expect(summary.isValid).toBe(false);
    expect(summary.errors).toContainEqual(
      expect.objectContaining({
        name: "Ozow base URL",
        detail: "OZOW_API_BASE_URL must use https://one.ozow.com in production",
      })
    );
  });

  it("fails production mode when the Ozow payment scope uses the legacy singular value", () => {
    const summary = validateLaunchConfiguration(
      {
        ...BASE_ENV,
        OZOW_PAYMENT_OAUTH_SCOPE: "payment",
      },
      { mode: "production" }
    );

    expect(summary.isValid).toBe(false);
    expect(summary.errors).toContainEqual(
      expect.objectContaining({
        name: "Ozow",
        detail: "OZOW_PAYMENT_OAUTH_SCOPE must be payments for Ozow One checkout",
      })
    );
  });

  it("allows missing KYC webhook secret when KYC_PROVIDER=stub", () => {
    const summary = validateLaunchConfiguration(
      {
        ...BASE_ENV,
        KYC_WEBHOOK_SECRET: undefined,
        KYC_PROVIDER: "stub",
      },
      { mode: "production" }
    );

    expect(summary.isValid).toBe(true);
    expect(summary.checks).toContainEqual(
      expect.objectContaining({
        name: "KYC webhook",
        status: "pass",
      })
    );
  });

  it("fails production mode when non-stub provider is enabled without KYC webhook secret", () => {
    const summary = validateLaunchConfiguration(
      {
        ...BASE_ENV,
        KYC_WEBHOOK_SECRET: undefined,
        KYC_PROVIDER: "smileid",
      },
      { mode: "production" }
    );

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

  it("warns in development mode when OZOW_API_BASE_URL is not an approved Ozow host", () => {
    const summary = validateLaunchConfiguration(
      {
        ...BASE_ENV,
        NODE_ENV: "development",
        OZOW_ENV: "staging",
        OZOW_API_BASE_URL: "https://proxy.example.com",
      },
      { mode: "development" }
    );

    expect(summary.isValid).toBe(true);
    expect(summary.warnings).toContainEqual(
      expect.objectContaining({
        name: "Ozow base URL",
      })
    );
  });
});

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
  AFRICASTALKING_SENDER_ID: "VERIFYMZANS",
  PAYFAST_MERCHANT_ID: "10000100",
  PAYFAST_MERCHANT_KEY: "merchant-key-value",
  PAYFAST_PASSPHRASE: "merchant-passphrase", // secret-scan: allow deterministic fixture
  PAYFAST_SANDBOX: "false",
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
        PAYFAST_SANDBOX: "true",
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
});

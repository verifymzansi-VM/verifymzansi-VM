import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateLaunchConfiguration, type EnvSource } from "../lib/config/launch-validation";

/**
 * Tests for production safety guards:
 * - Dev bypass flags blocked in production
 * - Dangerous env vars (BYPASS_OTP_CODE, TEST_PHONE_NUMBERS, SMS_MOCK)
 * - Instrumentation startup guard
 * - Mock Ozow production block
 */

// ── Helpers ──────────────────────────────────────────────────

function createBaseProductionEnv(): EnvSource {
  const hex64 = "a".repeat(64);
  return {
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-key-long-enough",
    SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role-key", // secret-scan: allow
    NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
    AFRICASTALKING_API_KEY: "real-api-key-value",
    AFRICASTALKING_USERNAME: "verifymzansi",
    AFRICASTALKING_SENDER_ID: "VerifyMZ",
    RESEND_API_KEY: "re_abc123def456",
    R2_ACCOUNT_ID: "cloudflare-r2-account-id",
    R2_ACCESS_KEY_ID: "r2-access-key-id-value",
    R2_SECRET_ACCESS_KEY: "r2-secret-access-key-value",
    KYC_ENCRYPTION_KEY: hex64,
    ID_ENCRYPTION_KEY: hex64,
    HMAC_SECRET: hex64,
    IP_HASH_SECRET: "a".repeat(32),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAACmVXwJ4jmJSu6fX",
    TURNSTILE_SECRET_KEY: "0x4AAAAAACmVXwJ4jmJSu6fY", // secret-scan: allow
    OZOW_ENV: "production",
    OZOW_CLIENT_ID: "ozow-client-id",
    OZOW_CLIENT_SECRET: "ozow-client-secret",
    OZOW_SITE_CODE: "ozow-site-code",
    OZOW_WEBHOOK_SECRET: "ozow-webhook-secret",
  };
}

// ── Dev-only flag tests ──────────────────────────────────────

describe("launch-validation: dev-only flags in production", () => {
  it("fails when ENABLE_MOCK_OZOW is set in production", () => {
    const env = { ...createBaseProductionEnv(), ENABLE_MOCK_OZOW: "true" };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const devFlagCheck = result.checks.find((c) => c.name === "Dev-only flags");
    expect(devFlagCheck?.status).toBe("fail");
    expect(devFlagCheck?.detail).toContain("ENABLE_MOCK_OZOW");
  });

  it("fails when ENABLE_DEV_PAYMENT_BYPASS is set in production", () => {
    const env = { ...createBaseProductionEnv(), ENABLE_DEV_PAYMENT_BYPASS: "1" };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const devFlagCheck = result.checks.find((c) => c.name === "Dev-only flags");
    expect(devFlagCheck?.status).toBe("fail");
    expect(devFlagCheck?.detail).toContain("ENABLE_DEV_PAYMENT_BYPASS");
  });

  it("fails when DEV_EXPOSE_OTP is set in production", () => {
    const env = { ...createBaseProductionEnv(), DEV_EXPOSE_OTP: "true" };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const devFlagCheck = result.checks.find((c) => c.name === "Dev-only flags");
    expect(devFlagCheck?.status).toBe("fail");
    expect(devFlagCheck?.detail).toContain("DEV_EXPOSE_OTP");
  });

  it("fails when ENABLE_DEV_KYC_WEBHOOK_BYPASS is set in production", () => {
    const env = { ...createBaseProductionEnv(), ENABLE_DEV_KYC_WEBHOOK_BYPASS: "true" };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const devFlagCheck = result.checks.find((c) => c.name === "Dev-only flags");
    expect(devFlagCheck?.status).toBe("fail");
    expect(devFlagCheck?.detail).toContain("ENABLE_DEV_KYC_WEBHOOK_BYPASS");
  });

  it("fails when ENABLE_TEST_POSTING_BYPASS is set in production", () => {
    const env = { ...createBaseProductionEnv(), ENABLE_TEST_POSTING_BYPASS: "true" };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const devFlagCheck = result.checks.find((c) => c.name === "Dev-only flags");
    expect(devFlagCheck?.status).toBe("fail");
    expect(devFlagCheck?.detail).toContain("ENABLE_TEST_POSTING_BYPASS");
  });

  it("fails when NEXT_PUBLIC_ENABLE_TEST_POSTING_BYPASS is set in production", () => {
    const env = { ...createBaseProductionEnv(), NEXT_PUBLIC_ENABLE_TEST_POSTING_BYPASS: "true" };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const devFlagCheck = result.checks.find((c) => c.name === "Dev-only flags");
    expect(devFlagCheck?.status).toBe("fail");
    expect(devFlagCheck?.detail).toContain("NEXT_PUBLIC_ENABLE_TEST_POSTING_BYPASS");
  });

  it("fails when ENABLE_DEV_TURNSTILE_BYPASS is set in production", () => {
    const env = { ...createBaseProductionEnv(), ENABLE_DEV_TURNSTILE_BYPASS: "true" };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const devFlagCheck = result.checks.find((c) => c.name === "Dev-only flags");
    expect(devFlagCheck?.status).toBe("fail");
    expect(devFlagCheck?.detail).toContain("ENABLE_DEV_TURNSTILE_BYPASS");
  });

  it("warns but passes when dev flags are set in development", () => {
    const env = { ...createBaseProductionEnv(), ENABLE_MOCK_OZOW: "true" };
    const result = validateLaunchConfiguration(env, { mode: "development" });

    const devFlagCheck = result.checks.find((c) => c.name === "Dev-only flags");
    expect(devFlagCheck?.status).toBe("warn");
    expect(devFlagCheck?.detail).toContain("ENABLE_MOCK_OZOW");
  });

  it("passes when no dev flags are set in production", () => {
    const env = createBaseProductionEnv();
    const result = validateLaunchConfiguration(env, { mode: "production" });

    const devFlagCheck = result.checks.find((c) => c.name === "Dev-only flags");
    expect(devFlagCheck?.status).toBe("pass");
  });
});

// ── Dangerous env var tests ──────────────────────────────────

describe("launch-validation: dangerous env vars in production", () => {
  it("fails when BYPASS_OTP_CODE is set in production", () => {
    const env = { ...createBaseProductionEnv(), BYPASS_OTP_CODE: "999999" };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const dangerCheck = result.checks.find((c) => c.name === "Dangerous env vars");
    expect(dangerCheck?.status).toBe("fail");
    expect(dangerCheck?.detail).toContain("BYPASS_OTP_CODE");
  });

  it("fails when TEST_PHONE_NUMBERS is set in production", () => {
    const env = { ...createBaseProductionEnv(), TEST_PHONE_NUMBERS: "+27600000000" };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const dangerCheck = result.checks.find((c) => c.name === "Dangerous env vars");
    expect(dangerCheck?.status).toBe("fail");
    expect(dangerCheck?.detail).toContain("TEST_PHONE_NUMBERS");
  });

  it("fails when SMS_MOCK is set in production", () => {
    const env = { ...createBaseProductionEnv(), SMS_MOCK: "true" };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const dangerCheck = result.checks.find((c) => c.name === "Dangerous env vars");
    expect(dangerCheck?.status).toBe("fail");
    expect(dangerCheck?.detail).toContain("SMS_MOCK");
  });

  it("fails when PLAYWRIGHT_TEST_MODE is set in production", () => {
    const env = { ...createBaseProductionEnv(), PLAYWRIGHT_TEST_MODE: "1" };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const dangerCheck = result.checks.find((c) => c.name === "Dangerous env vars");
    expect(dangerCheck?.status).toBe("fail");
    expect(dangerCheck?.detail).toContain("PLAYWRIGHT_TEST_MODE");
  });

  it("fails when multiple dangerous vars are set in production", () => {
    const env = {
      ...createBaseProductionEnv(),
      BYPASS_OTP_CODE: "999999",
      TEST_PHONE_NUMBERS: "+27600000000",
      SMS_MOCK: "true",
    };
    const result = validateLaunchConfiguration(env, { mode: "production" });

    expect(result.isValid).toBe(false);
    const dangerCheck = result.checks.find((c) => c.name === "Dangerous env vars");
    expect(dangerCheck?.status).toBe("fail");
    expect(dangerCheck?.detail).toContain("BYPASS_OTP_CODE");
    expect(dangerCheck?.detail).toContain("TEST_PHONE_NUMBERS");
    expect(dangerCheck?.detail).toContain("SMS_MOCK");
  });

  it("warns but passes when dangerous vars are set in development", () => {
    const env = { ...createBaseProductionEnv(), BYPASS_OTP_CODE: "999999" };
    const result = validateLaunchConfiguration(env, { mode: "development" });

    const dangerCheck = result.checks.find((c) => c.name === "Dangerous env vars");
    expect(dangerCheck?.status).toBe("warn");
    expect(dangerCheck?.detail).toContain("OK for dev");
  });

  it("passes when no dangerous vars are set in production", () => {
    const env = createBaseProductionEnv();
    const result = validateLaunchConfiguration(env, { mode: "production" });

    const dangerCheck = result.checks.find((c) => c.name === "Dangerous env vars");
    expect(dangerCheck?.status).toBe("pass");
  });
});

// ── Instrumentation dev bypass guard tests ───────────────────

describe("instrumentation: dev bypass startup guard", () => {
  const { mockValidateEnv, mockError, mockWarn } = vi.hoisted(() => ({
    mockValidateEnv: vi.fn(),
    mockError: vi.fn(),
    mockWarn: vi.fn(),
  }));

  vi.mock("../lib/config/env", () => ({
    validateEnv: mockValidateEnv,
  }));

  vi.mock("../lib/utils/logger", () => ({
    createLogger: () => ({
      error: mockError,
      warn: mockWarn,
    }),
  }));

  // We dynamically import to test with different env states
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    // Reset env
    delete process.env.BYPASS_OTP_CODE;
    delete process.env.TEST_PHONE_NUMBERS;
    delete process.env.ENABLE_MOCK_OZOW;
    delete process.env.ENABLE_DEV_PAYMENT_BYPASS;
    delete process.env.ENABLE_DEV_KYC_WEBHOOK_BYPASS;
    delete process.env.DEV_EXPOSE_OTP;
    delete process.env.SMS_MOCK;
    delete process.env.PLAYWRIGHT_TEST_MODE;
    delete process.env.ENABLE_TEST_POSTING_BYPASS;
    delete process.env.NEXT_PUBLIC_ENABLE_TEST_POSTING_BYPASS;
    delete process.env.ENABLE_DEV_TURNSTILE_BYPASS;
    delete process.env.VERIFYMZANSI_RUNTIME_MODE;
    delete process.env.VERIFYMZANSI_VALIDATION_MODE;
  });

  it("allows startup when no dev bypasses are set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { register, _resetInstrumentationForTesting } = await import("../instrumentation");
    _resetInstrumentationForTesting();

    await expect(register()).resolves.toBeUndefined();
  });

  it("blocks startup in production when BYPASS_OTP_CODE is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.BYPASS_OTP_CODE = "999999";
    const { register, _resetInstrumentationForTesting } = await import("../instrumentation");
    _resetInstrumentationForTesting();

    await expect(register()).rejects.toThrow("BYPASS_OTP_CODE");
    expect(mockError).toHaveBeenCalled();
  });

  it("blocks startup in production when ENABLE_MOCK_OZOW is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ENABLE_MOCK_OZOW = "true";
    const { register, _resetInstrumentationForTesting } = await import("../instrumentation");
    _resetInstrumentationForTesting();

    await expect(register()).rejects.toThrow("ENABLE_MOCK_OZOW");
  });

  it("blocks startup in production when ENABLE_DEV_KYC_WEBHOOK_BYPASS is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ENABLE_DEV_KYC_WEBHOOK_BYPASS = "true";
    const { register, _resetInstrumentationForTesting } = await import("../instrumentation");
    _resetInstrumentationForTesting();

    await expect(register()).rejects.toThrow("ENABLE_DEV_KYC_WEBHOOK_BYPASS");
  });

  it("blocks startup in production when PLAYWRIGHT_TEST_MODE is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.PLAYWRIGHT_TEST_MODE = "1";
    const { register, _resetInstrumentationForTesting } = await import("../instrumentation");
    _resetInstrumentationForTesting();

    await expect(register()).rejects.toThrow("PLAYWRIGHT_TEST_MODE");
  });

  it("allows explicit e2e runtime boot in production with Playwright flags", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.PLAYWRIGHT_TEST_MODE = "1";
    process.env.VERIFYMZANSI_RUNTIME_MODE = "e2e";
    process.env.VERIFYMZANSI_VALIDATION_MODE = "e2e";
    const { register, _resetInstrumentationForTesting } = await import("../instrumentation");
    _resetInstrumentationForTesting();

    await expect(register()).resolves.toBeUndefined();
  });

  it("blocks startup in production when ENABLE_TEST_POSTING_BYPASS is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ENABLE_TEST_POSTING_BYPASS = "true";
    const { register, _resetInstrumentationForTesting } = await import("../instrumentation");
    _resetInstrumentationForTesting();

    await expect(register()).rejects.toThrow("ENABLE_TEST_POSTING_BYPASS");
  });

  it("blocks startup in production when ENABLE_DEV_TURNSTILE_BYPASS is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ENABLE_DEV_TURNSTILE_BYPASS = "true";
    const { register, _resetInstrumentationForTesting } = await import("../instrumentation");
    _resetInstrumentationForTesting();

    await expect(register()).rejects.toThrow("ENABLE_DEV_TURNSTILE_BYPASS");
  });

  it("does not block startup in development even with dev bypasses", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.BYPASS_OTP_CODE = "999999";
    process.env.ENABLE_MOCK_OZOW = "true";
    const { register, _resetInstrumentationForTesting } = await import("../instrumentation");
    _resetInstrumentationForTesting();

    await expect(register()).resolves.toBeUndefined();
  });
});

describe("cloudflare preflight production overrides", () => {
  it("neutralizes every startup-blocking local override before Cloudflare builds", () => {
    const scriptPath = path.resolve(process.cwd(), "scripts", "preflight-cloudflare.js");
    const script = fs.readFileSync(scriptPath, "utf8");

    const requiredOverrides = [
      "BYPASS_OTP_CODE",
      "TEST_PHONE_NUMBERS",
      "ENABLE_MOCK_OZOW",
      "ENABLE_DEV_PAYMENT_BYPASS",
      "ENABLE_DEV_KYC_WEBHOOK_BYPASS",
      "ENABLE_TEST_POSTING_BYPASS",
      "NEXT_PUBLIC_ENABLE_TEST_POSTING_BYPASS",
      "ENABLE_DEV_TURNSTILE_BYPASS",
      "DEV_EXPOSE_OTP",
      "SMS_MOCK",
      "PLAYWRIGHT_TEST_MODE",
    ];

    for (const variableName of requiredOverrides) {
      expect(script).toContain(`"${variableName}"`);
    }
  });
});

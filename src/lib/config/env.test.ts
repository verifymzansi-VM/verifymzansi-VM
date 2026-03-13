import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { Env } from "./env";

// We need to reset module cache between tests since validateEnv caches
let validateEnv: () => Env;
let env: <K extends keyof Env>(key: K) => Env[K];
let checkCriticalEnvVars: () => string[];

// Minimal valid env for Zod schema
const VALID_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://xxx.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.1234567890",
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role", // secret-scan: allow
  R2_ACCOUNT_ID: "test-account-id",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  KYC_ENCRYPTION_KEY: "a".repeat(64),
  ID_ENCRYPTION_KEY: "b".repeat(64),
  AFRICASTALKING_API_KEY: "test-api-key",
  AFRICASTALKING_USERNAME: "sandbox",
  OZOW_ENV: "staging",
  OZOW_CLIENT_ID: "test-client-id",
  OZOW_CLIENT_SECRET: "test-client-secret",
  OZOW_SITE_CODE: "test-site-code",
  OZOW_WEBHOOK_SECRET: "test-webhook-secret",
  RESEND_API_KEY: "re_test_1234567890",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  HMAC_SECRET: "a".repeat(64),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA_test_site_key",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA_test_secret_key", // secret-scan: allow
  NODE_ENV: "test",
};

function stubNoBypassFlags() {
  vi.stubEnv("CI", "false");
  vi.stubEnv("SKIP_ENV_VALIDATION", "false");
  vi.stubEnv("npm_lifecycle_event", "");
}

describe("env config", () => {
  beforeEach(async () => {
    // Fresh module import for each test to clear cache
    vi.resetModules();

    // Prevent validation bypass during tests
    stubNoBypassFlags();

    // Stub all env vars
    for (const [key, value] of Object.entries(VALID_ENV)) {
      vi.stubEnv(key, value);
    }
    const mod = await import("./env");
    validateEnv = mod.validateEnv;
    env = mod.env;
    checkCriticalEnvVars = mod.checkCriticalEnvVars;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("validateEnv", () => {
    it("succeeds with valid environment", () => {
      const result = validateEnv();
      expect(result.NEXT_PUBLIC_SUPABASE_URL).toBe("https://xxx.supabase.co");
      expect(result.NODE_ENV).toBe("test");
    });

    it("returns cached result on second call", () => {
      const first = validateEnv();
      const second = validateEnv();
      expect(first).toBe(second);
    });

    it("throws with descriptive error when vars are missing", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
      const mod = await import("./env");

      expect(() => mod.validateEnv()).toThrow("Environment Configuration Error");
    });

    it("throws when KYC_ENCRYPTION_KEY is wrong length", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      vi.stubEnv("KYC_ENCRYPTION_KEY", "tooshort");
      const mod = await import("./env");

      expect(() => mod.validateEnv()).toThrow();
    });

    it("requires AFRICASTALKING_SENDER_ID in production", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("PAYFAST_PASSPHRASE", "prod-passphrase");
      vi.stubEnv("OZOW_ENV", "production");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      delete process.env.AFRICASTALKING_SENDER_ID;
      const mod = await import("./env");

      expect(() => mod.validateEnv()).toThrow("AFRICASTALKING_SENDER_ID is required in production");
    });

    it("requires NEXT_PUBLIC_APP_URL to use https in production", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AFRICASTALKING_SENDER_ID", "VerifyMzansi");
      vi.stubEnv("OZOW_ENV", "production");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      const mod = await import("./env");

      expect(() => mod.validateEnv()).toThrow("Production app URL must be public HTTPS");
    });

    it("allows e2e mode to bypass production-only launch rules", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "e2e");
      vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");
      vi.stubEnv("AFRICASTALKING_SENDER_ID", "VERIFYMZANS");
      vi.stubEnv("OZOW_ENV", "staging");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      const mod = await import("./env");

      expect(mod.validateEnv().NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:3000");
    });

    it("fails fast when RATE_LIMITER_API_KEY is set without OTP_RATE_LIMITER_URL", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("RATE_LIMITER_API_KEY", "test-rate-limit-key");
      delete process.env.OTP_RATE_LIMITER_URL;
      const mod = await import("./env");

      expect(() => mod.validateEnv()).toThrow(
        "RATE_LIMITER_API_KEY is set but OTP_RATE_LIMITER_URL is missing"
      );
    });
  });

  describe("env helper", () => {
    it("returns value after validation", () => {
      validateEnv();
      expect(env("NODE_ENV")).toBe("test");
    });

    it("falls back to process.env without validation", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      vi.stubEnv("NODE_ENV", "development");
      const mod = await import("./env");
      expect(mod.env("NODE_ENV")).toBe("development");
    });
  });

  describe("IP_HASH_SECRET", () => {
    it("accepts valid IP_HASH_SECRET", () => {
      vi.stubEnv("IP_HASH_SECRET", "a".repeat(32));
      const result = validateEnv();
      expect(result.IP_HASH_SECRET).toBe("a".repeat(32));
    });

    it("allows missing IP_HASH_SECRET (optional field)", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      // Explicitly remove IP_HASH_SECRET
      delete process.env.IP_HASH_SECRET;
      const mod = await import("./env");
      const result = mod.validateEnv();
      expect(result.IP_HASH_SECRET).toBeUndefined();
    });

    it("rejects IP_HASH_SECRET shorter than 32 characters", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("IP_HASH_SECRET", "tooshort");
      const mod = await import("./env");
      expect(() => mod.validateEnv()).toThrow();
    });
  });

  describe("build-phase fallback security", () => {
    it("does not use all-zero encryption keys in fallback", async () => {
      vi.resetModules();
      vi.stubEnv("npm_lifecycle_event", "build");
      vi.stubEnv("CI", "false");
      // Only set the 3 critical vars
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://xxx.supabase.co");
      vi.stubEnv(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.1234567890"
      );
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role");
      // Remove encryption keys to force fallback
      delete process.env.KYC_ENCRYPTION_KEY;
      delete process.env.ID_ENCRYPTION_KEY;
      delete process.env.HMAC_SECRET;

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const mod = await import("./env");
      const result = mod.validateEnv();

      // Fallback keys should NOT be all zeros
      expect(result.KYC_ENCRYPTION_KEY).not.toBe("0".repeat(64));
      expect(result.ID_ENCRYPTION_KEY).not.toBe("0".repeat(64));
      expect(result.HMAC_SECRET).not.toBe("0".repeat(64));
      warnSpy.mockRestore();
    });
  });

  describe("checkCriticalEnvVars", () => {
    it("returns empty array when all critical vars present", () => {
      expect(checkCriticalEnvVars()).toEqual([]);
    });

    it("returns missing var names", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mod = await import("./env");

      const missing = mod.checkCriticalEnvVars();
      expect(missing).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(missing).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

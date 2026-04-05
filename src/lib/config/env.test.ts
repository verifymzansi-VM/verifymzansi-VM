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
  AFRICASTALKING_SENDER_ID: "verifymzansi",
  OZOW_ENV: "staging",
  OZOW_CLIENT_ID: "test-client-id",
  OZOW_CLIENT_SECRET: "test-client-secret",
  OZOW_SITE_CODE: "test-site-code",
  OZOW_WEBHOOK_SECRET: "test-webhook-secret",
  KYC_WEBHOOK_SECRET: "test-kyc-webhook-secret",
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

    it("warns about AFRICASTALKING_SENDER_ID in production without throwing", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("OZOW_ENV", "production");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      delete process.env.AFRICASTALKING_SENDER_ID;
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mod = await import("./env");

      // Launch validation failures are now non-fatal; validateEnv logs instead of throwing
      expect(() => mod.validateEnv()).not.toThrow();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("Launch validation failed"));
      spy.mockRestore();
    });

    it("warns about NEXT_PUBLIC_APP_URL http in production without throwing", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AFRICASTALKING_SENDER_ID", "verifymzansi");
      vi.stubEnv("OZOW_ENV", "production");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mod = await import("./env");

      // Launch validation failures are now non-fatal
      expect(() => mod.validateEnv()).not.toThrow();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("Launch validation failed"));
      spy.mockRestore();
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
      vi.stubEnv("AFRICASTALKING_SENDER_ID", "verifymzansi");
      vi.stubEnv("OZOW_ENV", "staging");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      const mod = await import("./env");

      expect(mod.validateEnv().NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:3000");
    });

    it("throws in strict production mode when launch validation fails", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("OZOW_ENV", "production");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      const mod = await import("./env");

      expect(() => mod.validateEnv({ strict: true, mode: "production" })).toThrow(
        "Launch Configuration Error"
      );
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

    it("falls back to raw process.env in test mode when validation fails", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const mod = await import("./env");

      expect(mod.env("NEXT_PUBLIC_APP_URL")).toBe("http://localhost:3000");
    });
  });

  describe("IP_HASH_SECRET", () => {
    it("accepts valid IP_HASH_SECRET", () => {
      vi.stubEnv("IP_HASH_SECRET", "a".repeat(32));
      const result = validateEnv();
      expect(result.IP_HASH_SECRET).toBe("a".repeat(32));
    });

    it("allows missing IP_HASH_SECRET outside production", async () => {
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

    it("requires IP_HASH_SECRET in production", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AFRICASTALKING_SENDER_ID", "verifymzansi");
      vi.stubEnv("OZOW_ENV", "production");
      delete process.env.IP_HASH_SECRET;
      const mod = await import("./env");

      expect(() => mod.validateEnv()).toThrow("IP_HASH_SECRET is required in production");
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

    it("fails even in build mode when critical vars are missing", async () => {
      vi.resetModules();
      vi.stubEnv("npm_lifecycle_event", "build");
      vi.stubEnv("CI", "false");
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mod = await import("./env");

      expect(() => mod.validateEnv()).toThrow("Missing critical env vars");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Critical variables missing even during build")
      );
      errorSpy.mockRestore();
    });
  });

  describe("production security guards", () => {
    it("throws when cafebabe placeholder is used for KYC_ENCRYPTION_KEY in production", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("OZOW_ENV", "production");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      vi.stubEnv("AFRICASTALKING_SENDER_ID", "verifymzansi");
      vi.stubEnv("KYC_ENCRYPTION_KEY", "cafebabe".repeat(8));
      const mod = await import("./env");

      expect(() => mod.validateEnv()).toThrow("Insecure Placeholder Keys Detected");
    });

    it("throws when cafebabe placeholder is used for ID_ENCRYPTION_KEY in production", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("OZOW_ENV", "production");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      vi.stubEnv("AFRICASTALKING_SENDER_ID", "verifymzansi");
      vi.stubEnv("ID_ENCRYPTION_KEY", "cafebabe".repeat(8));
      const mod = await import("./env");

      expect(() => mod.validateEnv()).toThrow("Insecure Placeholder Keys Detected");
    });

    it("throws when cafebabe placeholder is used for HMAC_SECRET in production", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("OZOW_ENV", "production");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      vi.stubEnv("AFRICASTALKING_SENDER_ID", "verifymzansi");
      vi.stubEnv("HMAC_SECRET", "cafebabe".repeat(8));
      const mod = await import("./env");

      expect(() => mod.validateEnv()).toThrow("Insecure Placeholder Keys Detected");
    });

    it("does not throw when all three keys are real in production", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("OZOW_ENV", "production");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      vi.stubEnv("AFRICASTALKING_SENDER_ID", "verifymzansi");
      const mod = await import("./env");

      // VALID_ENV already has real hex keys (a*64, b*64, a*64 for HMAC)
      expect(() => mod.validateEnv()).not.toThrow();
    });

    it("does not check cafebabe in development mode", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      // NODE_ENV is "test" in VALID_ENV, explicitly set development
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("KYC_ENCRYPTION_KEY", "cafebabe".repeat(8));
      const mod = await import("./env");

      // cafebabe is only rejected in production — in dev it is allowed to aid local setup
      expect(() => mod.validateEnv()).not.toThrow();
    });

    it("rejects INVALID_BUILD_PLACEHOLDER keys via Zod validation", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("OZOW_ENV", "production");
      vi.stubEnv("IP_HASH_SECRET", "p".repeat(32));
      vi.stubEnv("AFRICASTALKING_SENDER_ID", "verifymzansi");
      vi.stubEnv("KYC_ENCRYPTION_KEY", "INVALID_BUILD_PLACEHOLDER_KYC_KEY__");
      const mod = await import("./env");

      // Zod schema rejects non-hex placeholder before the hard guard fires
      expect(() => mod.validateEnv()).toThrow("Environment Configuration Error");
    });

    it("strict mode re-validates even when cache exists", async () => {
      vi.resetModules();
      stubNoBypassFlags();
      for (const [key, value] of Object.entries(VALID_ENV)) {
        vi.stubEnv(key, value);
      }
      const mod = await import("./env");

      // First call populates cache
      const first = mod.validateEnv();
      expect(first.NODE_ENV).toBe("test");

      // Second call with strict should NOT return cached result;
      // it re-validates (here it succeeds, proving it re-ran)
      const second = mod.validateEnv({ strict: true });
      expect(second).not.toBe(first); // different object reference
      expect(second.NODE_ENV).toBe("test");
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

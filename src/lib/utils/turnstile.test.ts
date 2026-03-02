import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { verifyTurnstileToken, requireValidTurnstile } from "./turnstile";

describe("turnstile verification", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret-key-1234567890");
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("verifyTurnstileToken", () => {
    it("returns success for valid token", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            challenge_ts: "2026-01-01T00:00:00Z",
            hostname: "verifymzansi.co.za",
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await verifyTurnstileToken({ token: "test-token" });
      expect(result.success).toBe(true);
      expect(result.challengeTimestamp).toBe("2026-01-01T00:00:00Z");
    });

    it("returns failure for invalid token", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: false,
            "error-codes": ["invalid-input-response"],
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await verifyTurnstileToken({ token: "bad-token" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("invalid-input-response");
    });

    it("handles HTTP errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ success: false }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await verifyTurnstileToken({ token: "test" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 500");
    });

    it("handles fetch exceptions", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      const result = await verifyTurnstileToken({ token: "test" });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });

    it("allows bypass in development mode with placeholder token", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("TURNSTILE_SECRET_KEY", "");

      const result = await verifyTurnstileToken({ token: "dev-turnstile-bypass" });
      expect(result.success).toBe(true);
    });

    it("throws when secret key not configured in production", async () => {
      vi.stubEnv("TURNSTILE_SECRET_KEY", "");
      vi.stubEnv("NODE_ENV", "production");

      await expect(verifyTurnstileToken({ token: "test" })).rejects.toThrow(
        "Turnstile secret key not configured"
      );
    });

    it("sends remote IP when provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await verifyTurnstileToken({
        token: "test-token",
        remoteIp: "1.2.3.4",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining("1.2.3.4"),
        })
      );
    });
  });

  describe("requireValidTurnstile", () => {
    it("throws when token is missing", async () => {
      await expect(requireValidTurnstile(undefined)).rejects.toThrow("CAPTCHA token missing");
    });

    it("throws when token fails verification", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              success: false,
              "error-codes": ["timeout-or-duplicate"],
            }),
        })
      );

      await expect(requireValidTurnstile("expired-token")).rejects.toThrow("timeout-or-duplicate");
    });

    it("resolves for valid token", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
      );

      await expect(requireValidTurnstile("valid-token")).resolves.toBeUndefined();
    });
  });
});

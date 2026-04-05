import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimit, getClientIp, getClientRateLimitIdentity } from "./rate-limit";

describe("rate-limit", () => {
  beforeEach(() => {
    vi.stubEnv("OTP_RATE_LIMITER_URL", "https://rate-limiter.example.com");
    vi.stubEnv("RATE_LIMITER_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("checkRateLimit", () => {
    it("returns { limited: false } when OTP_RATE_LIMITER_URL is not set", async () => {
      vi.stubEnv("OTP_RATE_LIMITER_URL", "");

      const result = await checkRateLimit({ key: "test", action: "login" });
      expect(result.limited).toBe(false);
      expect(result.degraded).toBe(true);
    });

    it("fails closed when a sensitive action requires the shared rate limiter", async () => {
      vi.stubEnv("OTP_RATE_LIMITER_URL", "");

      const result = await checkRateLimit({
        key: "test",
        action: "auth:login",
        degradedMode: "block",
      });

      expect(result.limited).toBe(true);
      expect(result.degraded).toBe(true);
      expect(result.retryAfter).toBe(60);
    });

    it("returns { limited: false } when external worker returns 200", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));

      const result = await checkRateLimit({ key: "+27821234567", action: "otp:send" });
      expect(result.limited).toBe(false);
    });

    it("returns { limited: true } when external worker returns 429", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 429,
          json: () => Promise.resolve({ retryAfter: 30 }),
        })
      );

      const result = await checkRateLimit({ key: "+27821234567", action: "otp:send" });
      expect(result.limited).toBe(true);
      expect(result.retryAfter).toBe(30);
    });

    it("defaults retryAfter to 60 when worker does not provide it", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 429,
          json: () => Promise.resolve({}),
        })
      );

      const result = await checkRateLimit({ key: "test", action: "login" });
      expect(result.limited).toBe(true);
      expect(result.retryAfter).toBe(60);
    });

    it("handles 429 json parse failure gracefully", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          status: 429,
          json: () => Promise.reject(new Error("bad json")),
        })
      );

      const result = await checkRateLimit({ key: "test", action: "login" });
      expect(result.limited).toBe(true);
      expect(result.retryAfter).toBe(60);
    });

    it("falls back to local rate limiter when fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      // First request should pass (local fallback allows it)
      const result = await checkRateLimit({ key: "test-ip", action: "test" });
      expect(result.limited).toBe(false);
      expect(result.degraded).toBe(true);
    });

    it("falls back to local rate limiter on non-429 HTTP errors (e.g. 500)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, ok: false }));

      const result = await checkRateLimit({ key: "test-500", action: "test" });
      expect(result.limited).toBe(false);
      expect(result.degraded).toBe(true);
    });

    it("fails closed on 502 when degradedMode is block", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 502, ok: false }));

      const result = await checkRateLimit({
        key: "test-502",
        action: "billing:checkout",
        degradedMode: "block",
      });

      expect(result.limited).toBe(true);
      expect(result.degraded).toBe(true);
      expect(result.retryAfter).toBe(60);
    });

    it("fails closed on fetch errors when degradedMode is block", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      const result = await checkRateLimit({
        key: "test-ip",
        action: "billing:checkout",
        degradedMode: "block",
      });

      expect(result.limited).toBe(true);
      expect(result.degraded).toBe(true);
      expect(result.retryAfter).toBe(60);
    });

    it("local fallback limits after exceeding threshold", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      // Make 21 requests (local limit is 20)
      let lastResult: { limited: boolean; retryAfter?: number } = { limited: false };
      for (let i = 0; i < 21; i++) {
        lastResult = await checkRateLimit({ key: "flood-ip", action: "flood-test" });
      }

      expect(lastResult.limited).toBe(true);
      expect(lastResult.retryAfter).toBeGreaterThan(0);
    });

    it("passes deviceId in request body when provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
      vi.stubGlobal("fetch", mockFetch);

      await checkRateLimit({
        key: "+27821234567",
        action: "otp:send",
        deviceId: "device-abc123",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining("device-abc123"),
        })
      );
    });

    it("sends Authorization header when RATE_LIMITER_API_KEY is set", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
      vi.stubGlobal("fetch", mockFetch);

      await checkRateLimit({ key: "test", action: "login" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        })
      );
    });
  });

  describe("getClientIp", () => {
    it("returns the same key and IP when cf-connecting-ip is present", () => {
      const request = new Request("https://example.com", {
        headers: {
          "cf-connecting-ip": "1.2.3.4",
          "user-agent": "Mozilla/5.0",
        },
      });

      expect(getClientRateLimitIdentity(request)).toEqual({
        key: "1.2.3.4",
        source: "cf-connecting-ip",
        ip: "1.2.3.4",
      });
    });

    it("falls back to a fingerprint key when no IP headers are present", () => {
      const request = new Request("https://example.com", {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "accept-language": "en-ZA,en;q=0.9",
          host: "verifymzansi.com",
        },
      });

      expect(getClientRateLimitIdentity(request)).toMatchObject({
        source: "fingerprint",
      });
      expect(getClientRateLimitIdentity(request).key).toMatch(/^fp:[0-9a-f]{8}$/);
      expect(getClientIp(request)).toBe("unknown");
    });

    it("prefers cf-connecting-ip", () => {
      const request = new Request("https://example.com", {
        headers: {
          "cf-connecting-ip": "1.2.3.4",
          "x-forwarded-for": "5.6.7.8",
          "x-real-ip": "9.10.11.12",
        },
      });
      expect(getClientIp(request)).toBe("1.2.3.4");
    });

    it("falls back to x-forwarded-for first entry", () => {
      const request = new Request("https://example.com", {
        headers: {
          "x-forwarded-for": "5.6.7.8, 10.0.0.1",
          "x-real-ip": "9.10.11.12",
        },
      });
      expect(getClientIp(request)).toBe("5.6.7.8");
    });

    it("falls back to x-real-ip", () => {
      const request = new Request("https://example.com", {
        headers: { "x-real-ip": "9.10.11.12" },
      });
      expect(getClientIp(request)).toBe("9.10.11.12");
    });

    it("returns 'unknown' when no IP headers present", () => {
      const request = new Request("https://example.com");
      expect(getClientRateLimitIdentity(request)).toEqual({ key: "unknown", source: "unknown" });
      expect(getClientIp(request)).toBe("unknown");
    });
  });
});

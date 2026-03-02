import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimit, getClientIp } from "./rate-limit";

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
      expect(getClientIp(request)).toBe("unknown");
    });
  });
});

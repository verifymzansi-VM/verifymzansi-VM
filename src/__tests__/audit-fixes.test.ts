/**
 * Tests for bugs found in the senior code audit.
 * Each describe block maps to a specific fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. OTP timing-safe comparison ─────────────────────────────────────────

describe("OTP verifyOtp — timing-safe comparison", () => {
  // We test the `verifyOtp` function indirectly via the route, but the
  // core logic is pure crypto — we can unit-test it by extracting the
  // comparison logic.  Instead we verify the route-level behavior.

  const {
    mockGetUser,
    mockServerFrom,
    mockAdminFrom,
    mockAdminRpc,
    mockSendSms,
    mockCheckRateLimit,
    mockGetClientIp,
  } = vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockServerFrom: vi.fn(),
    mockAdminFrom: vi.fn(),
    mockAdminRpc: vi.fn(),
    mockSendSms: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockGetClientIp: vi.fn(),
  }));

  vi.mock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: mockGetUser },
      from: mockServerFrom,
    }),
  }));

  vi.mock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({ from: mockAdminFrom, rpc: mockAdminRpc }),
  }));

  vi.mock("@/lib/services/sms", () => ({
    sendSms: mockSendSms,
  }));

  vi.mock("@/lib/utils/logger", () => ({
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  }));

  vi.mock("@/lib/utils/rate-limit", () => ({
    checkRateLimit: mockCheckRateLimit,
    getClientIp: mockGetClientIp,
  }));

  // The route calls enforceSameOriginMutation and enforceCsrfToken
  vi.mock("@/lib/utils/mutation-origin", () => ({
    enforceSameOriginMutation: vi.fn().mockReturnValue(null),
  }));
  vi.mock("@/lib/utils/csrf", () => ({
    enforceCsrfToken: vi.fn().mockReturnValue(null),
  }));
  vi.mock("@/lib/account/ensure-profile", () => ({
    ensureAccountProfile: vi.fn().mockResolvedValue({ id: "profile-1" }),
    getDefaultDisplayName: vi.fn().mockReturnValue("Test User"),
  }));
  vi.mock("@/lib/account/compat", () => ({
    ACCOUNT_PROFILE_WRITE_TABLE: "account_profiles",
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockSendSms.mockResolvedValue({ success: true });
  });

  it("returns 400 for wrong OTP and calls increment_otp_attempt RPC", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/otp/verify/route");

    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    // Profile guard — no pending_phone
    mockServerFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { pending_phone: null }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    });

    // Create an OTP hash for "123456" so we can test with a wrong OTP
    const enc = new TextEncoder();
    const salt = "aa".repeat(16); // 16-byte salt as 32 hex chars
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode("123456"),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const derived = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: new Uint8Array(16).buffer as ArrayBuffer,
        iterations: 100000,
        hash: "SHA-512",
      },
      keyMaterial,
      512
    );
    const hashHex = Array.from(new Uint8Array(derived))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const storedHash = `${salt}:${hashHex}`;

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "otp_challenges") {
        return {
          select: () => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  gte: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        maybeSingle: () =>
                          Promise.resolve({
                            data: {
                              id: "challenge-1",
                              otp_hash: storedHash,
                              attempt_count: 0,
                              locked_until: null,
                              expires_at: new Date(Date.now() + 300000).toISOString(),
                            },
                            error: null,
                          }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return { from: vi.fn() };
    });

    mockAdminRpc.mockResolvedValue({
      data: [{ new_locked_until: null }],
      error: null,
    });

    const req = new NextRequest("http://localhost:3000/api/otp/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ otp: "999999", phone: "0712345678" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockAdminRpc).toHaveBeenCalledWith(
      "increment_otp_attempt",
      expect.objectContaining({ challenge_id: "challenge-1" })
    );
  });

  it("returns 503 when increment_otp_attempt RPC fails", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/otp/verify/route");

    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockServerFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { pending_phone: null }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    });

    const enc = new TextEncoder();
    const salt = "aa".repeat(16);
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode("123456"),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const derived = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: new Uint8Array(16).buffer as ArrayBuffer,
        iterations: 100000,
        hash: "SHA-512",
      },
      keyMaterial,
      512
    );
    const hashHex = Array.from(new Uint8Array(derived))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const storedHash = `${salt}:${hashHex}`;

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "otp_challenges") {
        return {
          select: () => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  gte: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        maybeSingle: () =>
                          Promise.resolve({
                            data: {
                              id: "challenge-1",
                              otp_hash: storedHash,
                              attempt_count: 0,
                              locked_until: null,
                              expires_at: new Date(Date.now() + 300000).toISOString(),
                            },
                            error: null,
                          }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return { from: vi.fn() };
    });

    // RPC fails
    mockAdminRpc.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });

    const req = new NextRequest("http://localhost:3000/api/otp/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ otp: "999999", phone: "0712345678" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("temporarily unavailable");
  });
});

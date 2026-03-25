import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as sendOtp } from "@/app/api/otp/send/route";
import { POST as verifyOtp } from "@/app/api/otp/verify/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as smsService from "@/lib/services/sms";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const CSRF_TOKEN = "a".repeat(64);
const OTP_PBKDF2_ITERATIONS = 100000;

async function hashOtpForTest(otp: string): Promise<string> {
  const salt = new Uint8Array(16);
  salt.fill(7);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(otp), "PBKDF2", false, [
    "deriveBits",
  ]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: OTP_PBKDF2_ITERATIONS,
      hash: "SHA-512",
    },
    keyMaterial,
    512
  );
  const toHex = (buf: Uint8Array) =>
    Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return `${toHex(salt)}:${toHex(new Uint8Array(derivedBits))}`;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/services/sms", () => ({
  sendOtpSms: vi.fn(),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

function createMockRequest(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: `vm_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

function createMissingCsrfRequest(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

describe("OTP Routes", () => {
  const mockUserClient = {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockUserClient.from.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }

      return {};
    });
    vi.mocked(createClient).mockResolvedValue(mockUserClient as never);
  });

  describe("POST /api/otp/send", () => {
    it("rejects requests without a CSRF token", async () => {
      const res = await sendOtp(
        createMissingCsrfRequest("/api/otp/send", { phone: "+27821234567" })
      );

      expect(res.status).toBe(403);
    });

    it("returns the shared rate-limit response when the external limiter blocks the request", async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, retryAfter: 45 });

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("45");
      expect(data).toMatchObject({
        error: "Too many OTP requests. Please wait before trying again.",
        code: "rate_limited",
        retryAfter: 45,
      });
    });

    it("keeps OTP send available when the shared limiter is degraded and only returns 429 after the fallback limit is hit", async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({
        limited: true,
        degraded: true,
        retryAfter: 30,
      });

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(data).toMatchObject({
        error: "Too many OTP requests. Please wait before trying again.",
        code: "rate_limited",
        retryAfter: 30,
      });
    });

    it("blocks when challenge send limit is exceeded", async () => {
      const adminQuery = {
        select: vi.fn(),
        eq: vi.fn(),
        gte: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
      };
      adminQuery.select.mockReturnValue(adminQuery);
      adminQuery.eq.mockReturnValue(adminQuery);
      adminQuery.gte.mockResolvedValue({ count: 5 });

      const invalidateQuery = {
        eq: vi.fn(),
        is: vi.fn().mockResolvedValue({ error: null }),
      };
      invalidateQuery.eq.mockReturnValue(invalidateQuery);
      adminQuery.update.mockReturnValue(invalidateQuery);
      adminQuery.insert.mockResolvedValue({ error: null });

      const mockAdminClient = {
        from: vi.fn().mockReturnValue(adminQuery),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("3600");
      expect(data.error).toBe("Maximum SMS limit reached. Please try again in 1 hour.");
      expect(data.code).toBe("hourly_limit_reached");
      expect(data.retryAfter).toBe(3600);
    });

    it("creates challenge and sends OTP when allowed", async () => {
      const otpLogInsert = vi
        .fn()
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: null });
      const adminQuery = {
        select: vi.fn(),
        eq: vi.fn(),
        gte: vi.fn(),
        update: vi.fn(),
        insert: otpLogInsert,
      };
      adminQuery.select.mockReturnValue(adminQuery);
      adminQuery.eq.mockReturnValue(adminQuery);
      adminQuery.gte.mockResolvedValue({ count: 0 });

      const invalidateQuery = {
        eq: vi.fn(),
        is: vi.fn().mockResolvedValue({ error: null }),
      };
      invalidateQuery.eq.mockReturnValue(invalidateQuery);
      adminQuery.update.mockReturnValue(invalidateQuery);

      const mockAdminClient = {
        from: vi.fn().mockReturnValue(adminQuery),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);
      vi.mocked(smsService.sendOtpSms).mockResolvedValue({
        success: true,
        messageId: "sms-1",
      } as never);

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toEqual({ success: true });
      expect(smsService.sendOtpSms).toHaveBeenCalledWith("+27821234567", expect.any(String));
      expect(otpLogInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: "+27821234567",
          delivery_status: "sent",
          provider_name: "africastalking",
          provider_message_id: "sms-1",
          provider_error: null,
        })
      );
    });

    it("returns a structured provider error when the SMS provider rejects the send", async () => {
      const otpLogInsert = vi
        .fn()
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: null });
      const adminQuery = {
        select: vi.fn(),
        eq: vi.fn(),
        gte: vi.fn(),
        update: vi.fn(),
        insert: otpLogInsert,
      };
      adminQuery.select.mockReturnValue(adminQuery);
      adminQuery.eq.mockReturnValue(adminQuery);
      adminQuery.gte.mockResolvedValue({ count: 0 });

      const invalidateQuery = {
        eq: vi.fn(),
        is: vi.fn().mockResolvedValue({ error: null }),
      };
      invalidateQuery.eq.mockReturnValue(invalidateQuery);
      adminQuery.update.mockReturnValue(invalidateQuery);

      const mockAdminClient = {
        from: vi.fn().mockReturnValue(adminQuery),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);
      vi.mocked(smsService.sendOtpSms).mockResolvedValue({
        success: false,
        error: "HTTP 401: Generator rejected",
      } as never);

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(502);
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(data).toMatchObject({
        error: "Failed to send OTP. Please try again.",
        code: "sms_delivery_failed",
        detail: "The SMS provider could not accept the message.",
        retryAfter: 60,
      });
      expect(otpLogInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: "+27821234567",
          delivery_status: "failed",
          provider_name: "africastalking",
          provider_message_id: undefined,
          provider_error: "HTTP 401: Generator rejected",
        })
      );
    });
  });

  it("returns service unavailable when admin client credentials are missing", async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error("Missing Supabase admin credentials");
    });

    const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data).toMatchObject({
      error: "Service temporarily unavailable",
      code: "database_unavailable",
    });
  });
  describe("POST /api/otp/verify", () => {
    it("rejects OTP verification requests without a CSRF token", async () => {
      const res = await verifyOtp(
        createMissingCsrfRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );

      expect(res.status).toBe(403);
    });

    it("returns 400 when there is no active challenge for the user+phone", async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return {};
        }),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid or expired OTP");
    });

    it("keeps OTP verification available when the shared limiter is degraded and only returns 429 after the fallback limit is hit", async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({
        limited: true,
        degraded: true,
        retryAfter: 25,
      });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("25");
      expect(data.error).toBe("Too many attempts. Please try again later.");
    });

    it("does not allow legacy bypass codes without a stored challenge", async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return {};
        }),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "999999" })
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: "Invalid or expired OTP",
      });
    });

    it("persists phone verification to profile, step, and session on success", async () => {
      const challengeUpdateIs = vi.fn().mockResolvedValue({ error: null });
      const challengeUpdateEq: ReturnType<typeof vi.fn> = vi.fn().mockImplementation(() => ({
        eq: challengeUpdateEq,
        is: challengeUpdateIs,
      }));
      const profileSelectMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: "profile-1" },
        error: null,
      });
      const profileSelectEq = vi.fn().mockReturnValue({
        maybeSingle: profileSelectMaybeSingle,
      });
      const profileUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const verificationStepUpsert = vi.fn().mockResolvedValue({ error: null });
      const sessionUpsert = vi.fn().mockResolvedValue({ error: null });
      const otpLogVerifyIs = vi.fn().mockResolvedValue({ error: null });
      const otpLogVerifyHashEq = vi.fn().mockReturnValue({ is: otpLogVerifyIs });
      const otpLogVerifyPhoneEq = vi.fn().mockReturnValue({ eq: otpLogVerifyHashEq });
      const storedHash = await hashOtpForTest("123456");

      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "challenge-1",
                  otp_hash: storedHash,
                  attempt_count: 0,
                  locked_until: null,
                  expires_at: new Date(Date.now() + 60_000).toISOString(),
                },
                error: null,
              }),
              update: vi.fn().mockReturnValue({
                eq: challengeUpdateEq,
              }),
            };
          }

          if (table === "verification_steps") {
            return {
              upsert: verificationStepUpsert,
            };
          }

          if (table === "otp_logs") {
            return {
              update: vi.fn().mockReturnValue({
                eq: otpLogVerifyPhoneEq,
              }),
            };
          }

          return {};
        }),
      };

      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);
      mockUserClient.from.mockImplementation((table: string) => {
        if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
          return {
            select: vi.fn().mockReturnValue({
              eq: profileSelectEq,
            }),
            update: vi.fn().mockReturnValue({
              eq: profileUpdateEq,
            }),
          };
        }

        if (table === "verification_sessions") {
          return {
            upsert: sessionUpsert,
          };
        }

        return {};
      });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toMatchObject({ success: true, verified: true });
      expect(profileUpdateEq).toHaveBeenCalledWith("id", "profile-1");
      expect(verificationStepUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user-1",
          step_type: "phone",
          status: "approved",
        }),
        { onConflict: "user_id,step_type" }
      );
      expect(sessionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user-1",
          phone_verified_at: expect.any(String),
        }),
        { onConflict: "user_id" }
      );
      expect(otpLogVerifyPhoneEq).toHaveBeenCalledWith("phone", "+27821234567");
      expect(otpLogVerifyHashEq).toHaveBeenCalledWith("otp_hash", storedHash);
      expect(otpLogVerifyIs).toHaveBeenCalledWith("verified_at", null);
    });

    it("retries profile create with admin client when user-scoped upsert is blocked", async () => {
      const challengeUpdateIs = vi.fn().mockResolvedValue({ error: null });
      const challengeUpdateEq: ReturnType<typeof vi.fn> = vi.fn().mockImplementation(() => ({
        eq: challengeUpdateEq,
        is: challengeUpdateIs,
      }));
      const profileSelectMaybeSingle = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });
      const profileSelectEq = vi.fn().mockReturnValue({
        maybeSingle: profileSelectMaybeSingle,
      });
      const profileUpsertSingle = vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "42501",
          message: "new row violates row-level security policy",
        },
      });
      const profileUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const verificationStepUpsert = vi.fn().mockResolvedValue({ error: null });
      const sessionUpsert = vi.fn().mockResolvedValue({ error: null });
      const otpLogVerifyIs = vi.fn().mockResolvedValue({ error: null });
      const otpLogVerifyHashEq = vi.fn().mockReturnValue({ is: otpLogVerifyIs });
      const otpLogVerifyPhoneEq = vi.fn().mockReturnValue({ eq: otpLogVerifyHashEq });
      const adminProfileUpsertSingle = vi.fn().mockResolvedValue({
        data: { id: "profile-created-by-admin" },
        error: null,
      });
      const storedHash = await hashOtpForTest("123456");

      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "challenge-1",
                  otp_hash: storedHash,
                  attempt_count: 0,
                  locked_until: null,
                  expires_at: new Date(Date.now() + 60_000).toISOString(),
                },
                error: null,
              }),
              update: vi.fn().mockReturnValue({
                eq: challengeUpdateEq,
              }),
            };
          }

          if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
            return {
              upsert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: adminProfileUpsertSingle,
                }),
              }),
            };
          }

          if (table === "verification_steps") {
            return {
              upsert: verificationStepUpsert,
            };
          }

          if (table === "otp_logs") {
            return {
              update: vi.fn().mockReturnValue({
                eq: otpLogVerifyPhoneEq,
              }),
            };
          }

          return {};
        }),
      };

      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);
      mockUserClient.from.mockImplementation((table: string) => {
        if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
          return {
            select: vi.fn().mockReturnValue({
              eq: profileSelectEq,
            }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: profileUpsertSingle,
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: profileUpdateEq,
            }),
          };
        }

        if (table === "verification_sessions") {
          return {
            upsert: sessionUpsert,
          };
        }

        return {};
      });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toMatchObject({ success: true, verified: true });
      expect(profileUpsertSingle).toHaveBeenCalledTimes(1);
      expect(adminProfileUpsertSingle).toHaveBeenCalledTimes(1);
      expect(profileUpdateEq).toHaveBeenCalledWith("id", "profile-created-by-admin");
    });

    it("retries profile update with admin client when user-scoped update is blocked", async () => {
      const challengeUpdateIs = vi.fn().mockResolvedValue({ error: null });
      const challengeUpdateEq: ReturnType<typeof vi.fn> = vi.fn().mockImplementation(() => ({
        eq: challengeUpdateEq,
        is: challengeUpdateIs,
      }));
      const profileSelectMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: "profile-1" },
        error: null,
      });
      const profileSelectEq = vi.fn().mockReturnValue({
        maybeSingle: profileSelectMaybeSingle,
      });
      const profileUpdateEq = vi.fn().mockResolvedValue({
        error: {
          code: "42501",
          message: "new row violates row-level security policy",
        },
      });
      const verificationStepUpsert = vi.fn().mockResolvedValue({ error: null });
      const sessionUpsert = vi.fn().mockResolvedValue({ error: null });
      const otpLogVerifyIs = vi.fn().mockResolvedValue({ error: null });
      const otpLogVerifyHashEq = vi.fn().mockReturnValue({ is: otpLogVerifyIs });
      const otpLogVerifyPhoneEq = vi.fn().mockReturnValue({ eq: otpLogVerifyHashEq });
      const adminProfileUpdateUserEq = vi.fn().mockResolvedValue({ error: null });
      const adminProfileUpdateIdEq = vi.fn().mockReturnValue({ eq: adminProfileUpdateUserEq });
      const storedHash = await hashOtpForTest("123456");

      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "challenge-1",
                  otp_hash: storedHash,
                  attempt_count: 0,
                  locked_until: null,
                  expires_at: new Date(Date.now() + 60_000).toISOString(),
                },
                error: null,
              }),
              update: vi.fn().mockReturnValue({
                eq: challengeUpdateEq,
              }),
            };
          }

          if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
            return {
              update: vi.fn().mockReturnValue({
                eq: adminProfileUpdateIdEq,
              }),
            };
          }

          if (table === "verification_steps") {
            return {
              upsert: verificationStepUpsert,
            };
          }

          if (table === "otp_logs") {
            return {
              update: vi.fn().mockReturnValue({
                eq: otpLogVerifyPhoneEq,
              }),
            };
          }

          return {};
        }),
      };

      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);
      mockUserClient.from.mockImplementation((table: string) => {
        if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
          return {
            select: vi.fn().mockReturnValue({
              eq: profileSelectEq,
            }),
            update: vi.fn().mockReturnValue({
              eq: profileUpdateEq,
            }),
          };
        }

        if (table === "verification_sessions") {
          return {
            upsert: sessionUpsert,
          };
        }

        return {};
      });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toMatchObject({ success: true, verified: true });
      expect(adminProfileUpdateIdEq).toHaveBeenCalledWith("id", "profile-1");
      expect(adminProfileUpdateUserEq).toHaveBeenCalledWith("user_id", "user-1");
    });

    it("returns 409 when the verified phone already belongs to another account", async () => {
      const storedHash = await hashOtpForTest("123456");
      const profileSelectMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: "profile-1" },
        error: null,
      });
      const profileSelectEq = vi.fn().mockReturnValue({
        maybeSingle: profileSelectMaybeSingle,
      });

      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "challenge-1",
                  otp_hash: storedHash,
                  attempt_count: 0,
                  locked_until: null,
                  expires_at: new Date(Date.now() + 60_000).toISOString(),
                },
                error: null,
              }),
              update: vi.fn().mockImplementation(() => {
                const chain: Record<string, unknown> = {};
                chain.eq = vi.fn().mockReturnValue(chain);
                chain.is = vi.fn().mockResolvedValue({ error: null });
                return chain;
              }),
            };
          }

          if (table === "verification_steps") {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }

          return {};
        }),
      };

      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);
      mockUserClient.from.mockImplementation((table: string) => {
        if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
          return {
            select: vi.fn().mockReturnValue({
              eq: profileSelectEq,
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                error: {
                  code: "23505",
                  message: "Phone number already linked to another account",
                },
              }),
            }),
          };
        }

        if (table === "verification_sessions") {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }

        return {};
      });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: "This phone number is already linked to another account.",
      });
    });

    it("rejects OTP verify when profile pending_phone does not match requested phone", async () => {
      const storedHash = await hashOtpForTest("123456");

      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "challenge-1",
                  otp_hash: storedHash,
                  attempt_count: 0,
                  locked_until: null,
                  expires_at: new Date(Date.now() + 60_000).toISOString(),
                },
                error: null,
              }),
              update: vi.fn().mockImplementation(() => {
                const chain: Record<string, unknown> = {};
                chain.eq = vi.fn().mockReturnValue(chain);
                chain.is = vi.fn().mockResolvedValue({ error: null });
                return chain;
              }),
            };
          }

          return {};
        }),
      };

      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);
      mockUserClient.from.mockImplementation((table: string) => {
        if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { pending_phone: "+27825555555" },
                  error: null,
                }),
              }),
            }),
          };
        }

        return {};
      });

      const res = await verifyOtp(
        createMockRequest("/api/otp/verify", { phone: "+27821234567", otp: "123456" })
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: "Invalid or expired OTP",
      });
    });
  });
});

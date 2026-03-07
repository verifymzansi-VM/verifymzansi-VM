import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as sendOtp } from "@/app/api/otp/send/route";
import { POST as verifyOtp } from "@/app/api/otp/verify/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as smsService from "@/lib/services/sms";

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
      iterations: 100000,
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

function createMockRequest(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(mockUserClient as never);
  });

  describe("POST /api/otp/send", () => {
    it("blocks when challenge send limit is exceeded", async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              gte: vi.fn().mockResolvedValue({ count: 5 }),
            };
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(data.error).toBe("Maximum SMS limit reached. Please try again in 1 hour.");
    });

    it("creates challenge and sends OTP when allowed", async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === "otp_challenges") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              gte: vi.fn().mockResolvedValue({ count: 0 }),
              insert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === "otp_logs") {
            return {
              insert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          return {};
        }),
      };
      vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);
      vi.mocked(smsService.sendOtpSms).mockResolvedValue({
        success: true,
        messageId: "sms-1",
      } as never);

      const res = await sendOtp(createMockRequest("/api/otp/send", { phone: "+27821234567" }));
      expect(res.status).toBe(200);
      expect(smsService.sendOtpSms).toHaveBeenCalledWith("+27821234567", expect.any(String));
    });
  });

  describe("POST /api/otp/verify", () => {
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

    it("persists phone verification to profile, step, and session on success", async () => {
      const challengeUpdateEq = vi.fn().mockReturnValue({
        is: vi.fn().mockResolvedValue({ error: null }),
      });
      const sellerUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const verificationStepUpsert = vi.fn().mockResolvedValue({ error: null });
      const sessionUpsert = vi.fn().mockResolvedValue({ error: null });
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

          if (table === "seller_profiles") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: { id: "profile-1" }, error: null }),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: sellerUpdateEq,
              }),
            };
          }

          if (table === "verification_steps") {
            return {
              upsert: verificationStepUpsert,
            };
          }

          if (table === "verification_sessions") {
            return {
              upsert: sessionUpsert,
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

      expect(res.status).toBe(200);
      expect(data).toMatchObject({ success: true, verified: true });
      expect(sellerUpdateEq).toHaveBeenCalledWith("id", "profile-1");
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
    });
  });
});

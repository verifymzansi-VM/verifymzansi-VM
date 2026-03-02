import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as sendOtp } from "@/app/api/otp/send/route";
import { POST as verifyOtp } from "@/app/api/otp/verify/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as smsService from "@/lib/services/sms";

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
  });
});

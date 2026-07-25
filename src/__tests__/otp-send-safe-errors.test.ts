import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetUser,
  mockServerFrom,
  mockAdminFrom,
  mockSendOtpSms,
  mockCheckRateLimit,
  mockGetClientIp,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockServerFrom: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockSendOtpSms: vi.fn(),
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
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

vi.mock("@/lib/services/sms", () => ({
  sendOtpSms: mockSendOtpSms,
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

import { POST } from "@/app/api/otp/send/route";

const CSRF_TOKEN = "a".repeat(64);

function createOtpRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/otp/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      cookie: `vm_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/otp/send safe error envelopes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServerFrom.mockImplementation(() => {
      const selectQuery = {
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      };
      const updateQuery = {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      return {
        select: vi.fn().mockReturnValue(selectQuery),
        update: vi.fn().mockReturnValue(updateQuery),
      };
    });
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", email_confirmed_at: "2026-01-01T00:00:00Z" } },
    });
    mockSendOtpSms.mockResolvedValue({ success: true });
  });

  it("does not leak database details when challenge creation fails", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "otp_logs") {
        const otpLogsQuery = {
          select: vi.fn(),
          eq: vi.fn(),
          gte: vi.fn(),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
        otpLogsQuery.select.mockReturnValue(otpLogsQuery);
        otpLogsQuery.eq.mockReturnValue(otpLogsQuery);
        otpLogsQuery.gte.mockResolvedValue({ count: 0 });
        return otpLogsQuery;
      }

      if (table === "otp_challenges") {
        const challengeQuery = {
          delete: vi.fn(),
          insert: vi.fn(),
        };

        const invalidateQuery = {
          eq: vi.fn(),
          is: vi.fn().mockResolvedValue({ error: null }),
        };
        invalidateQuery.eq.mockReturnValue(invalidateQuery);
        challengeQuery.delete.mockReturnValue(invalidateQuery);
        challengeQuery.insert.mockResolvedValue({
          error: {
            message: "duplicate key value violates unique constraint",
            code: "23505",
            details: "otp_challenges_user_id_phone_key",
            hint: null,
          },
        });
        return challengeQuery;
      }

      return {};
    });

    const res = await POST(createOtpRequest({ phone: "0712345678" }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "Failed to generate OTP",
      code: "otp_generation_failed",
    });
  });
});

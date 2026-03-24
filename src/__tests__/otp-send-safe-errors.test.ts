import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetUser, mockAdminFrom, mockSendOtpSms, mockCheckRateLimit, mockGetClientIp } =
  vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockAdminFrom: vi.fn(),
    mockSendOtpSms: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockGetClientIp: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
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
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
    mockSendOtpSms.mockResolvedValue({ success: true });
  });

  it("does not leak database details when challenge creation fails", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "otp_challenges") {
        const invalidateQuery = {
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ error: null }),
        };
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: 0 }),
          update: vi.fn().mockReturnValue(invalidateQuery),
          insert: vi.fn().mockResolvedValue({
            error: {
              message: "duplicate key value violates unique constraint",
              code: "23505",
              details: "otp_challenges_user_id_phone_key",
              hint: null,
            },
          }),
        };
      }

      if (table === "otp_logs") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
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

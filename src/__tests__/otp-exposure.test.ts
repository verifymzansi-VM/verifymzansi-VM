import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted mocks ───────────────────────────────────────────────────────────

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

// ── Helpers ─────────────────────────────────────────────────────────────────

function createOtpRequest(body: Record<string, unknown>, hostname = "localhost"): NextRequest {
  const url = `http://${hostname}:3000/api/otp/send`;
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: `http://${hostname}:3000`,
      cookie: `vm_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

function mockAuthenticatedUser(id = "user-123") {
  mockGetUser.mockResolvedValue({ data: { user: { id } } });
}

function mockOtpDbSuccess() {
  // Mock based on table name for challenge state + audit logs.
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "otp_challenges") {
      const challengeQuery = {
        select: vi.fn(),
        eq: vi.fn(),
        gte: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
      };
      challengeQuery.select.mockReturnValue(challengeQuery);
      challengeQuery.eq.mockReturnValue(challengeQuery);
      challengeQuery.gte.mockResolvedValue({ count: 0 });

      const invalidateQuery = {
        eq: vi.fn(),
        is: vi.fn().mockResolvedValue({ error: null }),
      };
      invalidateQuery.eq.mockReturnValue(invalidateQuery);
      challengeQuery.update.mockReturnValue(invalidateQuery);
      challengeQuery.insert.mockResolvedValue({ error: null });

      return challengeQuery;
    }
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
    return {};
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("OTP send — no OTP exposure", () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origDevFlag = process.env.DEV_EXPOSE_OTP;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServerFrom.mockImplementation(() => {
      const updateQuery = {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      return {
        update: vi.fn().mockReturnValue(updateQuery),
      };
    });
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockAuthenticatedUser();
    mockOtpDbSuccess();
    mockSendOtpSms.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    // Restore originals using vi.stubEnv-compatible approach
    (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
    if (origDevFlag !== undefined) {
      process.env.DEV_EXPOSE_OTP = origDevFlag;
    } else {
      delete process.env.DEV_EXPOSE_OTP;
    }
  });

  it("does NOT expose OTP in production environment", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.DEV_EXPOSE_OTP = "true";

    const req = createOtpRequest({ phone: "0712345678" }, "localhost");
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.devOtp).toBeUndefined();
    expect(body.testOtp).toBeUndefined();
    expect(body.success).toBe(true);
  });

  it("does NOT expose OTP when DEV_EXPOSE_OTP flag is missing", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    delete process.env.DEV_EXPOSE_OTP;

    const req = createOtpRequest({ phone: "0712345678" }, "localhost");
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.devOtp).toBeUndefined();
    expect(body.testOtp).toBeUndefined();
  });

  it("does NOT expose OTP on non-localhost hostnames", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.DEV_EXPOSE_OTP = "true";

    const req = createOtpRequest({ phone: "0712345678" }, "staging.example.com");
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.devOtp).toBeUndefined();
    expect(body.testOtp).toBeUndefined();
  });

  it("does NOT expose OTP even when the old dev flag is enabled on localhost", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.DEV_EXPOSE_OTP = "true";

    const req = createOtpRequest({ phone: "0712345678" }, "localhost");
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.devOtp).toBeUndefined();
    expect(body.testOtp).toBeUndefined();
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const req = createOtpRequest({ phone: "0712345678" });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid phone number", async () => {
    const req = createOtpRequest({ phone: "invalid" });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});

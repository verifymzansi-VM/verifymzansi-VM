import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetUser,
  mockLogAuditEvent,
  mockParseAndValidateJsonRequest,
  mockAdminFrom,
  mockCheckRateLimit,
  mockGetClientIp,
  mockIsFeatureEnabled,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockParseAndValidateJsonRequest: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockAdminFrom,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: mockAdminFrom,
  }),
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("@/lib/utils/api", () => ({
  parseAndValidateJsonRequest: mockParseAndValidateJsonRequest,
}));

vi.mock("@/lib/constants/verification", () => ({
  MANUAL_ONLY_BASELINE_RISK: 20,
}));
vi.mock("@/lib/account/verification-summary", () => ({
  summarizeVerification: vi.fn().mockReturnValue({
    accountVerificationStatus: "pending_review",
  }),
}));
vi.mock("@/lib/services/feature-flags", () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

import { POST } from "@/app/api/verification/location/manual/route";
import type { NextRequest } from "next/server";

const CSRF_TOKEN = "a".repeat(64);

function makeRequest(body: Record<string, unknown>) {
  const headers = new Headers({
    cookie: `vm_csrf=${CSRF_TOKEN}`,
    "x-csrf-token": CSRF_TOKEN,
  });

  return {
    url: "http://localhost:3000/api/verification/location/manual",
    json: () => Promise.resolve(body),
    headers,
    nextUrl: new URL("http://localhost:3000/api/verification/location/manual"),
  } as unknown as NextRequest;
}

function setupAuthenticatedUser() {
  mockGetUser.mockResolvedValue({
    data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
    error: null,
  });

  const mockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { account_verification_status: "incomplete" },
    }),
    update: vi.fn().mockReturnThis(),
  };

  const mockUpsertChain = {
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "step-1" }, error: null }),
  };

  // Chain for verification_steps .select().eq() queries (allSteps + id_doc detail)
  const mockStepsSelectChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockImplementation((_col: string, val: string) => {
        // If a second .eq is chained (for step_type filter), return single()
        if (val === "id_doc") {
          return {
            single: vi.fn().mockResolvedValue({ data: null }),
          };
        }
        // First .eq(user_id) — resolves to list of steps
        return {
          data: [{ step_type: "location", status: "approved" }],
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null }),
          }),
        };
      }),
    }),
    upsert: vi.fn().mockReturnValue(mockUpsertChain),
  };

  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "verification_steps") {
      return mockStepsSelectChain;
    }
    if (table === "kyc_risk_signals") {
      return { insert: vi.fn().mockResolvedValue({}) };
    }
    if (table === "verification_sessions") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
        upsert: vi.fn().mockResolvedValue({}),
      };
    }
    // account_profiles
    return {
      select: vi.fn().mockReturnValue(mockChain),
      update: vi.fn().mockReturnValue(mockChain),
    };
  });
}

describe("POST /api/verification/location/manual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockIsFeatureEnabled.mockResolvedValue(true);
  });

  it("should return 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await POST(makeRequest({ province: "Gauteng", city: "Johannesburg" }));
    expect(res.status).toBe(401);
  });

  it("should return 400 for invalid province", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        province: "NotAProvince",
        city: "SomeCity",
      },
    });

    const res = await POST(makeRequest({ province: "NotAProvince", city: "SomeCity" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid province");
  });

  it("should return 400 for invalid city in valid province", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        province: "Gauteng",
        city: "NotACity",
      },
    });

    const res = await POST(makeRequest({ province: "Gauteng", city: "NotACity" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid city");
  });

  it("should succeed with valid province and city", async () => {
    setupAuthenticatedUser();
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        province: "Gauteng",
        city: "Johannesburg",
      },
    });

    const res = await POST(makeRequest({ province: "Gauteng", city: "Johannesburg" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.province).toBe("Gauteng");
    expect(body.city).toBe("Johannesburg");
    expect(body.riskScore).toBe(20);
    expect(body.riskLevel).toBe("low");
  });

  it("normalizes province aliases and city casing before persistence", async () => {
    setupAuthenticatedUser();
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        province: "kzn",
        city: "durban",
      },
    });

    const res = await POST(makeRequest({ province: "kzn", city: "durban" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.province).toBe("KwaZulu-Natal");
    expect(body.city).toBe("Durban");
  });

  it("should return 400 for empty body", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: false,
      response: Response.json({ error: "Invalid JSON payload" }, { status: 400 }),
    });

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});

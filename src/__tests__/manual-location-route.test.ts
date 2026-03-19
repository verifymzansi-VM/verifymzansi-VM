import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetUser,
  mockLogAuditEvent,
  mockParseJson,
  mockAdminFrom,
  mockCheckRateLimit,
  mockGetClientIp,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockParseJson: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
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
  parseJsonRequest: mockParseJson,
}));

vi.mock("@/lib/constants/verification", () => ({
  MANUAL_ONLY_BASELINE_RISK: 20,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

import { POST } from "@/app/api/verification/location/manual/route";
import type { NextRequest } from "next/server";

function makeRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
    headers: { get: () => null },
    nextUrl: new URL("http://localhost:3000/api/verification/location/manual"),
  } as unknown as NextRequest;
}

function setupAuthenticatedUser() {
  mockGetUser.mockResolvedValue({
    data: { user: { id: "u1" } },
    error: null,
  });

  const mockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
    update: vi.fn().mockReturnThis(),
  };

  const mockUpsertChain = {
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "step-1" }, error: null }),
  };

  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "verification_steps") {
      return {
        upsert: vi.fn().mockReturnValue(mockUpsertChain),
      };
    }
    if (table === "kyc_risk_signals") {
      return { insert: vi.fn().mockResolvedValue({}) };
    }
    if (table === "verification_sessions") {
      return { upsert: vi.fn().mockResolvedValue({}) };
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
  });

  it("should return 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await POST(makeRequest({ province: "Gauteng", city: "Johannesburg" }));
    expect(res.status).toBe(401);
  });

  it("should return 400 for invalid province", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });
    mockParseJson.mockResolvedValue({
      province: "NotAProvince",
      city: "SomeCity",
    });

    const res = await POST(makeRequest({ province: "NotAProvince", city: "SomeCity" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid province");
  });

  it("should return 400 for invalid city in valid province", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });
    mockParseJson.mockResolvedValue({
      province: "Gauteng",
      city: "NotACity",
    });

    const res = await POST(makeRequest({ province: "Gauteng", city: "NotACity" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid city");
  });

  it("should succeed with valid province and city", async () => {
    setupAuthenticatedUser();
    mockParseJson.mockResolvedValue({
      province: "Gauteng",
      city: "Johannesburg",
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

  it("should return 400 for empty body", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });
    mockParseJson.mockResolvedValue(null);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});

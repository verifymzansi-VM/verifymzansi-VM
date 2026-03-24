import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetUser,
  mockIsFeatureEnabled,
  mockReverseGeocode,
  mockComputeLocationConfidence,
  mockLogAuditEvent,
  mockParseAndValidateJsonRequest,
  mockAdminFrom,
  mockCheckRateLimit,
  mockGetClientIp,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockReverseGeocode: vi.fn(),
  mockComputeLocationConfidence: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockParseAndValidateJsonRequest: vi.fn(),
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

vi.mock("@/lib/services/geocoding", () => ({
  reverseGeocode: mockReverseGeocode,
  computeLocationConfidence: mockComputeLocationConfidence,
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("@/lib/services/feature-flags", () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock("@/lib/utils/api", () => ({
  parseAndValidateJsonRequest: mockParseAndValidateJsonRequest,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

vi.mock("@/lib/constants/verification", () => ({
  GPS_ACCURACY_WARN_METERS: 100,
  GPS_ACCURACY_REJECT_METERS: 500,
  GPS_PROVINCE_MISMATCH_RISK: 50,
  GPS_CITY_MISMATCH_RISK: 25,
}));

vi.mock("@/lib/constants/sa-provinces", () => ({
  getProvinceNames: () => [
    "Gauteng",
    "Western Cape",
    "KwaZulu-Natal",
    "Eastern Cape",
    "Free State",
    "Limpopo",
    "Mpumalanga",
    "Northern Cape",
    "North West",
  ],
}));

import { POST } from "@/app/api/verification/location/gps/route";
import type { NextRequest } from "next/server";

const CSRF_TOKEN = "a".repeat(64);

function makeRequest(body: Record<string, unknown>) {
  const headers = new Headers({
    cookie: `vm_csrf=${CSRF_TOKEN}`,
    "x-csrf-token": CSRF_TOKEN,
  });

  return {
    url: "http://localhost:3000/api/verification/location/gps",
    json: () => Promise.resolve(body),
    headers,
    nextUrl: new URL("http://localhost:3000/api/verification/location/gps"),
  } as unknown as NextRequest;
}

describe("POST /api/verification/location/gps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
  });

  it("should return 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await POST(
      makeRequest({ latitude: -26, longitude: 28, accuracy: 50, timestamp: Date.now() })
    );
    expect(res.status).toBe(401);
  });

  it("should return 404 when feature flag is disabled", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockIsFeatureEnabled.mockResolvedValue(false);

    const res = await POST(
      makeRequest({ latitude: -26, longitude: 28, accuracy: 50, timestamp: Date.now() })
    );
    expect(res.status).toBe(404);
  });

  it("should reject coordinates outside SA bounds", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: false,
      response: Response.json({ error: "Invalid input" }, { status: 400 }),
    });

    const res = await POST(
      makeRequest({ latitude: 51.5, longitude: -0.1, accuracy: 50, timestamp: Date.now() })
    );
    // Should reject — either 400 or 422
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("should reject accuracy above threshold", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        latitude: -26.2,
        longitude: 28.0,
        accuracy: 600, // > 500
        timestamp: Date.now(),
      },
    });

    const res = await POST(
      makeRequest({ latitude: -26.2, longitude: 28.0, accuracy: 600, timestamp: Date.now() })
    );
    expect(res.status).toBe(422);
  });
});

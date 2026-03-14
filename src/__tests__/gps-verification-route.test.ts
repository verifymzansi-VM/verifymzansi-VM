import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetUser,
  mockIsFeatureEnabled,
  mockReverseGeocode,
  mockComputeLocationConfidence,
  mockLogAuditEvent,
  mockParseJson,
  mockAdminFrom,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockReverseGeocode: vi.fn(),
  mockComputeLocationConfidence: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockParseJson: vi.fn(),
  mockAdminFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
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
  parseJsonRequest: mockParseJson,
}));

vi.mock("@/lib/constants/verification", () => ({
  GPS_ACCURACY_WARN_METERS: 100,
  GPS_ACCURACY_REJECT_METERS: 500,
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

function makeRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
    headers: { get: () => null },
    nextUrl: new URL("http://localhost:3000/api/verification/location/gps"),
  } as unknown as NextRequest;
}

describe("POST /api/verification/location/gps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      data: { user: { id: "u1" } },
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
      data: { user: { id: "u1" } },
      error: null,
    });
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockParseJson.mockResolvedValue({
      latitude: 51.5,
      longitude: -0.1,
      accuracy: 50,
      timestamp: Date.now(),
    });

    const res = await POST(
      makeRequest({ latitude: 51.5, longitude: -0.1, accuracy: 50, timestamp: Date.now() })
    );
    // Should reject — either 400 or 422
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("should reject accuracy above threshold", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockParseJson.mockResolvedValue({
      latitude: -26.2,
      longitude: 28.0,
      accuracy: 600, // > 500
      timestamp: Date.now(),
    });

    const res = await POST(
      makeRequest({ latitude: -26.2, longitude: 28.0, accuracy: 600, timestamp: Date.now() })
    );
    expect(res.status).toBe(422);
  });
});

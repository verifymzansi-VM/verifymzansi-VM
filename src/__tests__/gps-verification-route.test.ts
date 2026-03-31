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
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

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

  it("persists a low-risk GPS confirmation as an approved location step", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        latitude: -26.2041,
        longitude: 28.0473,
        accuracy: 12,
        timestamp: Date.now(),
        declaredProvince: "Gauteng",
        declaredCity: "Johannesburg",
      },
    });
    mockReverseGeocode.mockResolvedValue({
      province: "Gauteng",
      city: "Johannesburg",
      source: "nominatim",
    });
    mockComputeLocationConfidence.mockReturnValue("high");

    const upsertVerificationStep = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "step-1" }, error: null }),
    });
    const updateProfile = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "profile-1", account_verification_status: "incomplete" },
              }),
            }),
          }),
          update: updateProfile,
        };
      }

      if (table === "verification_sessions") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }

      if (table === "verification_steps") {
        return {
          upsert: upsertVerificationStep,
          select: vi.fn().mockImplementation((columns: string) => {
            if (columns === "step_type, status") {
              return {
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { step_type: "phone", status: "approved" },
                    { step_type: "id_doc", status: "pending" },
                    { step_type: "selfie", status: "approved" },
                    { step_type: "location", status: "approved" },
                  ],
                }),
              };
            }

            return {
              eq: vi.fn(),
            };
          }),
        };
      }

      if (table === "kyc_risk_signals") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }

      if (table === "kyc_artifacts") {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }

      return {};
    });

    const res = await POST(
      makeRequest({
        latitude: -26.2041,
        longitude: 28.0473,
        accuracy: 12,
        timestamp: Date.now(),
        declaredProvince: "Gauteng",
        declaredCity: "Johannesburg",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        verified: true,
        stepStatus: "approved",
      })
    );

    expect(upsertVerificationStep).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "approved",
        auto_status: "approved",
        location_method: "manual_with_gps",
        location_province: "Gauteng",
        location_city: "Johannesburg",
      }),
      expect.objectContaining({ onConflict: "user_id,step_type" })
    );
    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        location_province: "Gauteng",
        location_city: "Johannesburg",
        account_verification_status: "pending_review",
      })
    );
  });

  it("falls back to location_method gps when manual_with_gps enum value is missing (22P02)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        latitude: -29.8587,
        longitude: 31.0218,
        accuracy: 15,
        timestamp: Date.now(),
        declaredProvince: "KwaZulu-Natal",
        declaredCity: "Richards Bay",
      },
    });
    mockReverseGeocode.mockResolvedValue({
      province: "KwaZulu-Natal",
      city: "Richards Bay",
      source: "nominatim",
    });
    mockComputeLocationConfidence.mockReturnValue("high");

    let upsertCallCount = 0;
    const upsertVerificationStep = vi.fn().mockImplementation(() => {
      upsertCallCount++;
      const isFirstCall = upsertCallCount === 1;
      return {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(
          isFirstCall
            ? {
                data: null,
                error: {
                  code: "22P02",
                  message: 'invalid input value for enum location_method: "manual_with_gps"',
                  details: null,
                },
              }
            : { data: { id: "step-fallback" }, error: null }
        ),
      };
    });

    const updateProfile = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "profile-1", account_verification_status: "incomplete" },
              }),
            }),
          }),
          update: updateProfile,
        };
      }
      if (table === "verification_sessions") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === "verification_steps") {
        return {
          upsert: upsertVerificationStep,
          select: vi.fn().mockImplementation((columns: string) => {
            if (columns === "step_type, status") {
              return {
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { step_type: "phone", status: "approved" },
                    { step_type: "id_doc", status: "pending" },
                    { step_type: "selfie", status: "approved" },
                    { step_type: "location", status: "approved" },
                  ],
                }),
              };
            }
            return { eq: vi.fn() };
          }),
        };
      }
      if (table === "kyc_risk_signals") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "kyc_artifacts") {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const res = await POST(
      makeRequest({
        latitude: -29.8587,
        longitude: 31.0218,
        accuracy: 15,
        timestamp: Date.now(),
        declaredProvince: "KwaZulu-Natal",
        declaredCity: "Richards Bay",
      })
    );

    // Should succeed via fallback, not return 500
    expect(res.status).toBe(200);

    // First upsert used manual_with_gps, second used gps
    expect(upsertVerificationStep).toHaveBeenCalledTimes(2);
    expect(upsertVerificationStep).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ location_method: "manual_with_gps" }),
      expect.anything()
    );
    expect(upsertVerificationStep).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ location_method: "gps" }),
      expect.anything()
    );
  });
});

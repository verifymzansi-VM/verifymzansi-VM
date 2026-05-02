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
  GPS_MAX_AGE_MS: 60_000,
  GPS_REPLAY_REJECT_MS: 5 * 60_000,
  GPS_PROVINCE_MISMATCH_RISK: 50,
  GPS_CITY_MISMATCH_RISK: 25,
}));

vi.mock("@/lib/constants/sa-provinces", async () => {
  return vi.importActual("@/lib/constants/sa-provinces");
});

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

const DEFAULT_STEP_SUMMARY = [
  { step_type: "phone", status: "approved" },
  { step_type: "id_doc", status: "pending" },
  { step_type: "selfie", status: "approved" },
  { step_type: "location", status: "approved" },
];

function createVerificationSessionsTable({
  existingSession = null,
  currentSession = null,
  upsert = vi.fn().mockResolvedValue({ error: null }),
  update = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      is: vi.fn().mockResolvedValue({ error: null }),
    }),
  }),
}: {
  existingSession?: Record<string, unknown> | null;
  currentSession?: Record<string, unknown> | null;
  upsert?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    select: vi.fn().mockImplementation((columns: string) => ({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: columns.trim().startsWith("finalized_at") ? existingSession : currentSession,
          error: null,
        }),
      }),
    })),
    upsert,
    update,
  };
}

function createVerificationStepsTable({
  upsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "step-1" }, error: null }),
  }),
  allSteps = DEFAULT_STEP_SUMMARY,
  phoneVerifiedAt = null,
  idDocDetail = null,
  locationStep = null,
}: {
  upsert?: ReturnType<typeof vi.fn>;
  allSteps?: Array<{ step_type: string; status: string; reviewed_at?: string | null }>;
  phoneVerifiedAt?: string | null;
  idDocDetail?: Record<string, unknown> | null;
  locationStep?: Record<string, unknown> | null;
} = {}) {
  return {
    upsert,
    select: vi.fn().mockImplementation((columns: string) => {
      if (columns === "status, location_method, location_province, location_city") {
        return {
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: locationStep,
                error: null,
              }),
            }),
          }),
        };
      }

      if (columns === "step_type, status" || columns === "step_type, status, reviewed_at") {
        return {
          eq: vi.fn().mockResolvedValue({ data: allSteps, error: null }),
        };
      }

      if (columns === "phone_verified_at") {
        return {
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: phoneVerifiedAt ? { phone_verified_at: phoneVerifiedAt } : null,
                error: null,
              }),
            }),
          }),
        };
      }

      if (columns === "first_name, last_name") {
        return {
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: idDocDetail, error: null }),
            }),
          }),
        };
      }

      return {
        eq: vi.fn(),
      };
    }),
  };
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
        return createVerificationSessionsTable();
      }

      if (table === "verification_steps") {
        return createVerificationStepsTable({
          upsert: upsertVerificationStep,
        });
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

  it("rejects GPS confirmation after a manual location has already finalized the session", async () => {
    const upsertVerificationStep = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "step-1" }, error: null }),
    });
    const upsertSession = vi.fn().mockResolvedValue({ error: null });
    const finalizeSession = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

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

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "profile-1", account_verification_status: "pending_review" },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }

      if (table === "verification_sessions") {
        return createVerificationSessionsTable({
          existingSession: {
            finalized_at: "2026-04-21T12:02:00.000Z",
            location_submitted_at: "2026-04-21T12:01:00.000Z",
          },
          currentSession: {
            id_artifact_id: "artifact-id",
            selfie_artifact_id: "artifact-selfie",
            location_submitted_at: "2026-04-21T12:01:00.000Z",
            finalized_at: "2026-04-21T12:02:00.000Z",
          },
          upsert: upsertSession,
          update: finalizeSession,
        });
      }

      if (table === "verification_steps") {
        return createVerificationStepsTable({
          upsert: upsertVerificationStep,
          phoneVerifiedAt: "2026-04-21T12:00:00.000Z",
          locationStep: {
            status: "approved",
            location_method: "manual",
            location_province: "Gauteng",
            location_city: "Johannesburg",
          },
        });
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
        latitude: -26.2041,
        longitude: 28.0473,
        accuracy: 12,
        timestamp: Date.now(),
        declaredProvince: "Gauteng",
        declaredCity: "Johannesburg",
      })
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        error: "Verification session is already finalized",
      })
    );
    expect(upsertVerificationStep).not.toHaveBeenCalled();
    expect(upsertSession).not.toHaveBeenCalled();
    expect(finalizeSession).not.toHaveBeenCalled();
  });

  it("rejects finalized GPS confirmation when it does not match the saved manual address", async () => {
    const upsertVerificationStep = vi.fn();

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
        declaredProvince: "Western Cape",
        declaredCity: "Cape Town",
      },
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "profile-1", account_verification_status: "pending_review" },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "verification_sessions") {
        return createVerificationSessionsTable({
          existingSession: {
            finalized_at: "2026-04-21T12:02:00.000Z",
            location_submitted_at: "2026-04-21T12:01:00.000Z",
          },
        });
      }

      if (table === "verification_steps") {
        return createVerificationStepsTable({
          upsert: upsertVerificationStep,
          locationStep: {
            status: "approved",
            location_method: "manual",
            location_province: "Gauteng",
            location_city: "Johannesburg",
          },
        });
      }

      return {};
    });

    const res = await POST(
      makeRequest({
        latitude: -26.2041,
        longitude: 28.0473,
        accuracy: 12,
        timestamp: Date.now(),
        declaredProvince: "Western Cape",
        declaredCity: "Cape Town",
      })
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        error: "Verification session is already finalized",
      })
    );
    expect(mockReverseGeocode).not.toHaveBeenCalled();
    expect(upsertVerificationStep).not.toHaveBeenCalled();
  });

  it("does not allow finalized GPS confirmation to mutate a GPS-only location step", async () => {
    const upsertVerificationStep = vi.fn();

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

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "profile-1", account_verification_status: "pending_review" },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "verification_sessions") {
        return createVerificationSessionsTable({
          existingSession: {
            finalized_at: "2026-04-21T12:02:00.000Z",
            location_submitted_at: "2026-04-21T12:01:00.000Z",
          },
        });
      }

      if (table === "verification_steps") {
        return createVerificationStepsTable({
          upsert: upsertVerificationStep,
          locationStep: {
            status: "approved",
            location_method: "gps",
            location_province: "Gauteng",
            location_city: "Johannesburg",
          },
        });
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

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        error: "Verification session is already finalized",
      })
    );
    expect(mockReverseGeocode).not.toHaveBeenCalled();
    expect(upsertVerificationStep).not.toHaveBeenCalled();
  });

  it("finalizes the verification session when GPS location is the last missing step", async () => {
    const finalizeSession = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

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

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "profile-1", account_verification_status: "incomplete" },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }

      if (table === "verification_sessions") {
        return createVerificationSessionsTable({
          currentSession: {
            id_artifact_id: "artifact-id",
            selfie_artifact_id: "artifact-selfie",
            location_submitted_at: "2026-04-21T12:01:00.000Z",
            finalized_at: null,
          },
          update: finalizeSession,
        });
      }

      if (table === "verification_steps") {
        return createVerificationStepsTable({
          phoneVerifiedAt: "2026-04-21T12:00:00.000Z",
        });
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
        latitude: -26.2041,
        longitude: 28.0473,
        accuracy: 12,
        timestamp: Date.now(),
        declaredProvince: "Gauteng",
        declaredCity: "Johannesburg",
      })
    );

    expect(res.status).toBe(200);
    expect(finalizeSession).toHaveBeenCalledWith(
      expect.objectContaining({ finalized_at: expect.any(String) })
    );
  });

  it("does not finalize the GPS session when required verification artifacts are still missing", async () => {
    const finalizeSession = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

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

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "profile-1", account_verification_status: "incomplete" },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }

      if (table === "verification_sessions") {
        return createVerificationSessionsTable({
          currentSession: {
            id_artifact_id: "artifact-id",
            selfie_artifact_id: null,
            location_submitted_at: "2026-04-21T12:01:00.000Z",
            finalized_at: null,
          },
          update: finalizeSession,
        });
      }

      if (table === "verification_steps") {
        return createVerificationStepsTable({
          phoneVerifiedAt: "2026-04-21T12:00:00.000Z",
        });
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
        latitude: -26.2041,
        longitude: 28.0473,
        accuracy: 12,
        timestamp: Date.now(),
        declaredProvince: "Gauteng",
        declaredCity: "Johannesburg",
      })
    );

    expect(res.status).toBe(200);
    expect(finalizeSession).not.toHaveBeenCalled();
  });

  it("treats canonical city aliases as a GPS match for the selected city", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        latitude: -33.9608,
        longitude: 25.6022,
        accuracy: 15,
        timestamp: Date.now(),
        declaredProvince: "Eastern Cape",
        declaredCity: "Port Elizabeth (Gqeberha)",
      },
    });
    mockReverseGeocode.mockResolvedValue({
      province: "Eastern Cape",
      city: "Gqeberha",
      source: "nominatim",
    });
    mockComputeLocationConfidence.mockReturnValue("high");

    const upsertVerificationStep = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "step-ec" }, error: null }),
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
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }

      if (table === "verification_sessions") {
        return createVerificationSessionsTable();
      }

      if (table === "verification_steps") {
        return createVerificationStepsTable({
          upsert: upsertVerificationStep,
        });
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
        latitude: -33.9608,
        longitude: 25.6022,
        accuracy: 15,
        timestamp: Date.now(),
        declaredProvince: "Eastern Cape",
        declaredCity: "Port Elizabeth (Gqeberha)",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        verified: true,
        mismatch: {
          province: false,
          city: false,
        },
      })
    );
    expect(upsertVerificationStep).toHaveBeenCalledWith(
      expect.objectContaining({
        location_province: "Eastern Cape",
        location_city: "Port Elizabeth (Gqeberha)",
      }),
      expect.anything()
    );
  });

  it("returns success with warning-only city mismatch but does not mark the address GPS-verified", async () => {
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
        accuracy: 15,
        timestamp: Date.now(),
        declaredProvince: "Gauteng",
        declaredCity: "Johannesburg",
      },
    });
    mockReverseGeocode.mockResolvedValue({
      province: "Gauteng",
      city: "Pretoria",
      source: "nominatim",
    });
    mockComputeLocationConfidence.mockReturnValue("medium");

    const insertedSignals: unknown[] = [];
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
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }

      if (table === "verification_sessions") {
        return createVerificationSessionsTable();
      }

      if (table === "verification_steps") {
        return createVerificationStepsTable({
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: "step-city-mismatch" }, error: null }),
          }),
        });
      }

      if (table === "kyc_risk_signals") {
        return {
          insert: vi.fn((rows: unknown[]) => {
            insertedSignals.push(...rows);
            return Promise.resolve({ error: null });
          }),
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
        accuracy: 15,
        timestamp: Date.now(),
        declaredProvince: "Gauteng",
        declaredCity: "Johannesburg",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        verified: false,
        mismatch: {
          province: false,
          city: true,
        },
      })
    );
    expect(insertedSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal_code: "gps_city_mismatch", severity: "warn" }),
      ])
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
        return createVerificationSessionsTable();
      }
      if (table === "verification_steps") {
        return createVerificationStepsTable({
          upsert: upsertVerificationStep,
        });
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

  it("returns non-fatal success when optional manual GPS confirmation cannot be persisted", async () => {
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
            : {
                data: null,
                error: {
                  code: "23514",
                  message: "new row for relation verification_steps violates check constraint",
                  details: "failing row contains ...",
                },
              }
        ),
      };
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
        };
      }
      if (table === "verification_sessions") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return createVerificationStepsTable({
          upsert: upsertVerificationStep,
        });
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

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        persisted: false,
        warning: "Failed to save location verification",
        verified: false,
      })
    );
  });

  it("adds a gps_stale_reading risk signal when timestamp is older than GPS_MAX_AGE_MS", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockIsFeatureEnabled.mockResolvedValue(true);

    const staleTimestamp = Date.now() - 120_000; // 2 minutes ago, >60s threshold
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        latitude: -26.2041,
        longitude: 28.0473,
        accuracy: 12,
        timestamp: staleTimestamp,
      },
    });
    mockReverseGeocode.mockResolvedValue({
      province: "Gauteng",
      city: "Johannesburg",
      source: "nominatim",
    });
    mockComputeLocationConfidence.mockReturnValue("high");

    const insertedSignals: unknown[] = [];
    const upsertVerificationStep = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "step-1" }, error: null }),
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
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === "verification_sessions") {
        return createVerificationSessionsTable();
      }
      if (table === "verification_steps") {
        return createVerificationStepsTable({
          upsert: upsertVerificationStep,
        });
      }
      if (table === "kyc_risk_signals") {
        return {
          insert: vi.fn((rows: unknown[]) => {
            insertedSignals.push(...rows);
            return Promise.resolve({ error: null });
          }),
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
        timestamp: staleTimestamp,
      })
    );

    expect(res.status).toBe(200);
    expect(insertedSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signal_code: "gps_stale_reading",
          severity: "warn",
        }),
      ])
    );
  });

  it("hard-rejects GPS reading older than GPS_REPLAY_REJECT_MS as gps_replay_detected", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockIsFeatureEnabled.mockResolvedValue(true);

    const replayTimestamp = Date.now() - 6 * 60_000; // 6 minutes ago, > 5 min threshold
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        latitude: -26.2041,
        longitude: 28.0473,
        accuracy: 12,
        timestamp: replayTimestamp,
      },
    });
    mockReverseGeocode.mockResolvedValue({
      province: "Gauteng",
      city: "Johannesburg",
      source: "nominatim",
    });
    mockComputeLocationConfidence.mockReturnValue("high");

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
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
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
        timestamp: replayTimestamp,
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        code: "gps_replay_detected",
        error: expect.stringMatching(/too old/i),
      })
    );
  });
});

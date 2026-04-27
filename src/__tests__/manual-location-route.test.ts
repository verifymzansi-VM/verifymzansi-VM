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
  allSteps = [{ step_type: "location", status: "approved" }],
  phoneVerifiedAt = null,
  idDocDetail = null,
  locationStep = null,
  upsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "step-1" }, error: null }),
  }),
}: {
  allSteps?: Array<{ step_type: string; status: string; reviewed_at?: string | null }>;
  phoneVerifiedAt?: string | null;
  idDocDetail?: Record<string, unknown> | null;
  locationStep?: Record<string, unknown> | null;
  upsert?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    upsert,
    select: vi.fn().mockImplementation((columns: string) => {
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

      if (columns === "status, location_method, location_province, location_city") {
        return {
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: locationStep, error: null }),
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

  const verificationSessionsTable = createVerificationSessionsTable();
  const verificationStepsTable = createVerificationStepsTable();

  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "verification_steps") {
      return verificationStepsTable;
    }
    if (table === "kyc_risk_signals") {
      return { insert: vi.fn().mockResolvedValue({}) };
    }
    if (table === "verification_sessions") {
      return verificationSessionsTable;
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

  it("finalizes the verification session when location completes the last missing step", async () => {
    const finalizedAtUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        province: "Gauteng",
        city: "Johannesburg",
      },
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return createVerificationStepsTable({
          allSteps: [
            { step_type: "phone", status: "approved" },
            { step_type: "id_doc", status: "pending" },
            { step_type: "selfie", status: "approved" },
            { step_type: "location", status: "approved" },
          ],
          phoneVerifiedAt: "2026-04-21T12:00:00.000Z",
        });
      }

      if (table === "kyc_risk_signals") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }

      if (table === "verification_sessions") {
        return createVerificationSessionsTable({
          currentSession: {
            id_artifact_id: "artifact-id",
            selfie_artifact_id: "artifact-selfie",
            location_submitted_at: "2026-04-21T12:01:00.000Z",
            finalized_at: null,
          },
          update: finalizedAtUpdate,
        });
      }

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "profile-1", account_verification_status: "incomplete" },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    });

    const res = await POST(makeRequest({ province: "Gauteng", city: "Johannesburg" }));

    expect(res.status).toBe(200);
    expect(finalizedAtUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ finalized_at: expect.any(String) })
    );
  });

  it("backfills a missing location step without reopening an already-finalized session", async () => {
    const sessionUpsert = vi.fn().mockResolvedValue({ error: null });
    const finalizedAtUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        province: "Gauteng",
        city: "Johannesburg",
      },
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return createVerificationStepsTable({
          allSteps: [
            { step_type: "phone", status: "approved" },
            { step_type: "id_doc", status: "pending" },
            { step_type: "selfie", status: "pending" },
            { step_type: "location", status: "approved" },
          ],
          phoneVerifiedAt: "2026-04-21T12:00:00.000Z",
          locationStep: null,
        });
      }

      if (table === "kyc_risk_signals") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }

      if (table === "verification_sessions") {
        return createVerificationSessionsTable({
          existingSession: {
            finalized_at: "2026-04-21T12:02:00.000Z",
            location_submitted_at: null,
          },
          currentSession: {
            id_artifact_id: "artifact-id",
            selfie_artifact_id: "artifact-selfie",
            location_submitted_at: "2026-04-21T12:01:00.000Z",
            finalized_at: "2026-04-21T12:02:00.000Z",
          },
          upsert: sessionUpsert,
          update: finalizedAtUpdate,
        });
      }

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "profile-1", account_verification_status: "pending_review" },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    });

    const res = await POST(makeRequest({ province: "Gauteng", city: "Johannesburg" }));

    expect(res.status).toBe(200);
    expect(sessionUpsert).toHaveBeenCalledWith(
      expect.not.objectContaining({ finalized_at: null }),
      expect.objectContaining({ onConflict: "user_id" })
    );
    expect(finalizedAtUpdate).not.toHaveBeenCalled();
  });

  it("does not finalize the verification session when prerequisites are still missing", async () => {
    const finalizedAtUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
      error: null,
    });
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: {
        province: "Gauteng",
        city: "Johannesburg",
      },
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return createVerificationStepsTable({
          allSteps: [
            { step_type: "phone", status: "approved" },
            { step_type: "id_doc", status: "pending" },
            { step_type: "location", status: "approved" },
          ],
          phoneVerifiedAt: "2026-04-21T12:00:00.000Z",
        });
      }

      if (table === "kyc_risk_signals") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }

      if (table === "verification_sessions") {
        return createVerificationSessionsTable({
          currentSession: {
            id_artifact_id: "artifact-id",
            selfie_artifact_id: null,
            location_submitted_at: "2026-04-21T12:01:00.000Z",
            finalized_at: null,
          },
          update: finalizedAtUpdate,
        });
      }

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "profile-1", account_verification_status: "incomplete" },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    });

    const res = await POST(makeRequest({ province: "Gauteng", city: "Johannesburg" }));

    expect(res.status).toBe(200);
    expect(finalizedAtUpdate).not.toHaveBeenCalled();
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

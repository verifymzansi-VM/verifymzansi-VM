import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

// ── Hoisted mocks ────────────────────────────────────────────

const { mockCreateClient, mockCreateAdminClient, mockFrom, mockLogAuditEvent } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
  mockLogAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { POST } from "./route";

// ── Helpers ──────────────────────────────────────────────────

function createMockRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
  } as unknown as Request;
}

function mockAuth(user: { id: string; app_metadata?: Record<string, unknown> } | null) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: "Not authenticated" },
      }),
    },
  });
}

/** Build a chainable mock for the artifact-sync update:
 *  .update().eq().eq().in().order().limit()
 */
function artifactSyncChain(resolvedValue = { error: null }) {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(resolvedValue),
            }),
          }),
        }),
      }),
    }),
  };
}

/** Build a chainable mock for the purge update:
 *  .update().eq().is()
 */
function artifactPurgeChain(resolvedValue = { error: null }) {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

const STEP_UUID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const MEMBER_UUID = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const ADMIN_UUID = "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";
const MOD_UUID = "d3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44";
const NONEXISTENT_UUID = "e4eebc99-9c0b-4ef8-bb6d-6bb9bd380a55";

const baseStep = {
  id: STEP_UUID,
  user_id: MEMBER_UUID,
  step_type: "id_doc",
  status: "pending",
  risk_level: "low",
  risk_score: 10,
  submitted_at: new Date().toISOString(),
};

// ── Tests ────────────────────────────────────────────────────

describe("POST /api/admin/verification/decide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ from: mockFrom });
    mockLogAuditEvent.mockResolvedValue(undefined);
  });

  it("returns 401 when user is not authenticated", async () => {
    mockAuth(null);
    const response = await POST(createMockRequest({ stepId: STEP_UUID, decision: "approved" }));
    expect(response.status).toBe(401);
  });

  it("returns 403 when user is not admin or moderator", async () => {
    mockAuth({ id: MEMBER_UUID, app_metadata: { role: "member" } });
    const response = await POST(createMockRequest({ stepId: STEP_UUID, decision: "approved" }));
    expect(response.status).toBe(403);
  });

  it("returns 400 for invalid payload", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });
    const response = await POST(createMockRequest({ decision: "approved" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when rejecting without reason code", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });
    const response = await POST(createMockRequest({ stepId: STEP_UUID, decision: "rejected" }));
    expect(response.status).toBe(400);
  });

  it("returns 404 when step does not exist", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
            }),
          }),
        };
      }
      return {};
    });

    const response = await POST(
      createMockRequest({ stepId: NONEXISTENT_UUID, decision: "approved" })
    );
    expect(response.status).toBe(404);
  });

  it("requires override reason when approving high-risk step", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });

    const highRiskStep = { ...baseStep, risk_level: "high", risk_score: 65 };

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: highRiskStep, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const response = await POST(createMockRequest({ stepId: STEP_UUID, decision: "approved" }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Override reason code is required");
  });

  it("allows approving high-risk step with override reason", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });

    const highRiskStep = { ...baseStep, risk_level: "high", risk_score: 65 };
    const profileUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: STEP_UUID }], error: null }),
        }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockImplementation((...args: unknown[]) => {
            if (args[0] === "*") {
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: highRiskStep, error: null }),
                }),
              };
            }

            return {
              eq: vi.fn().mockResolvedValue({
                data: [{ step_type: "phone", status: "approved" }],
                error: null,
              }),
            };
          }),
          update: updateMock,
        };
      }
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          update: profileUpdate,
        };
      }
      if (table === "kyc_artifacts") {
        return artifactSyncChain();
      }
      return {};
    });

    const response = await POST(
      createMockRequest({
        stepId: STEP_UUID,
        decision: "approved",
        overrideReasonCode: "verified_in_person",
      })
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.decision).toBe("approved");
  });

  it("approves step and checks all-4-steps completion", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: STEP_UUID }], error: null }),
        }),
      }),
    });

    let artifactSyncCalled = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockImplementation((...args: unknown[]) => {
            // If selecting *, it's the step lookup
            if (args[0] === "*") {
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: baseStep, error: null }),
                }),
              };
            }
            // If selecting step_type, status, it's the all-steps check
            return {
              eq: vi.fn().mockResolvedValue({
                data: [
                  { step_type: "phone", status: "approved" },
                  { step_type: "id_doc", status: "approved" },
                  { step_type: "selfie", status: "approved" },
                  { step_type: "location", status: "approved" },
                ],
                error: null,
              }),
            };
          }),
          update: updateMock,
        };
      }
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "kyc_artifacts") {
        // First call: artifact sync; second call: purge scheduling
        if (!artifactSyncCalled) {
          artifactSyncCalled = true;
          return artifactSyncChain();
        }
        return artifactPurgeChain();
      }
      return {};
    });

    const response = await POST(createMockRequest({ stepId: STEP_UUID, decision: "approved" }));
    expect(response.status).toBe(200);

    // Should schedule purge and log purge event
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kyc_purge_scheduled",
      })
    );
  });

  it("rejects step with reason code", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });

    const profileUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: STEP_UUID }], error: null }),
        }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: baseStep, error: null }),
            }),
          }),
          update: updateMock,
        };
      }
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          update: profileUpdate,
        };
      }
      if (table === "kyc_artifacts") {
        return artifactSyncChain();
      }
      return {};
    });

    const response = await POST(
      createMockRequest({
        stepId: STEP_UUID,
        decision: "rejected",
        reasonCode: "blurry_image",
        reasonNote: "The photo is very blurry",
      })
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.decision).toBe("rejected");
    expect(profileUpdate).toHaveBeenCalledWith({
      account_verification_status: "rejected",
    });
  });

  it("moderator can also make decisions", async () => {
    mockAuth({ id: MOD_UUID, app_metadata: { role: "moderator" } });
    const profileUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: STEP_UUID }], error: null }),
        }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockImplementation((...args: unknown[]) => {
            if (args[0] === "*") {
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: baseStep, error: null }),
                }),
              };
            }

            return {
              eq: vi.fn().mockResolvedValue({
                data: [{ step_type: "phone", status: "approved" }],
                error: null,
              }),
            };
          }),
          update: updateMock,
        };
      }
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          update: profileUpdate,
        };
      }
      if (table === "kyc_artifacts") {
        return artifactSyncChain();
      }
      return {};
    });

    const response = await POST(createMockRequest({ stepId: STEP_UUID, decision: "approved" }));
    expect(response.status).toBe(200);
  });

  it("returns 403 for unrecognized role (e.g. super_admin)", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "super_admin" } });
    const response = await POST(createMockRequest({ stepId: STEP_UUID, decision: "approved" }));
    expect(response.status).toBe(403);
  });

  it("does not log kyc_purge_scheduled when purge DB update fails", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: STEP_UUID }], error: null }),
        }),
      }),
    });

    let purgeArtifactSyncCalled = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockImplementation((...args: unknown[]) => {
            if (args[0] === "*") {
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: baseStep, error: null }),
                }),
              };
            }
            return {
              eq: vi.fn().mockResolvedValue({
                data: [
                  { step_type: "phone", status: "approved" },
                  { step_type: "id_doc", status: "approved" },
                  { step_type: "selfie", status: "approved" },
                  { step_type: "location", status: "approved" },
                ],
                error: null,
              }),
            };
          }),
          update: updateMock,
        };
      }
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "kyc_artifacts") {
        // First call: artifact sync (succeeds); second call: purge update (FAILS)
        if (!purgeArtifactSyncCalled) {
          purgeArtifactSyncCalled = true;
          return artifactSyncChain();
        }
        return artifactPurgeChain({ error: { message: "DB error" } });
      }
      return {};
    });

    const response = await POST(createMockRequest({ stepId: STEP_UUID, decision: "approved" }));
    expect(response.status).toBe(200);

    // kyc_purge_scheduled should NOT be logged since purge update failed
    const purgeCall = mockLogAuditEvent.mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).action === "kyc_purge_scheduled"
    );
    expect(purgeCall).toBeUndefined();
  });

  it("accepts legacy 'resubmit' and normalizes to 'needs_resubmission'", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });
    const profileUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: STEP_UUID }], error: null }),
        }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockImplementation((...args: unknown[]) => {
            if (args[0] === "*") {
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: baseStep, error: null }),
                }),
              };
            }

            return {
              eq: vi.fn().mockResolvedValue({
                data: [{ step_type: "phone", status: "approved" }],
                error: null,
              }),
            };
          }),
          update: updateMock,
        };
      }
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          update: profileUpdate,
        };
      }
      if (table === "kyc_artifacts") {
        return artifactSyncChain();
      }
      return {};
    });

    const response = await POST(
      createMockRequest({
        stepId: STEP_UUID,
        decision: "resubmit",
        reasonCode: "blurry_image",
        reasonNote: "Image is too blurry to verify identity",
      })
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.decision).toBe("needs_resubmission");
    // needs_resubmission should set account status to pending_review, not rejected
    expect(profileUpdate).toHaveBeenCalledWith({
      account_verification_status: "pending_review",
    });
  });

  it("sets account status to pending_review (not rejected) for needs_resubmission", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });
    const profileUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: STEP_UUID }], error: null }),
        }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: baseStep, error: null }),
            }),
          }),
          update: updateMock,
        };
      }
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          update: profileUpdate,
        };
      }
      if (table === "kyc_artifacts") {
        return artifactSyncChain();
      }
      return {};
    });

    const response = await POST(
      createMockRequest({
        stepId: STEP_UUID,
        decision: "needs_resubmission",
        reasonCode: "blurry_image",
        reasonNote: "Please retake with better lighting",
      })
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.decision).toBe("needs_resubmission");
    expect(profileUpdate).toHaveBeenCalledWith({
      account_verification_status: "pending_review",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

// ── Hoisted mocks ────────────────────────────────────────────

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCreateNotification,
  mockFrom,
  mockGetUserById,
  mockLogAuditEvent,
  mockEnforceSameOriginMutation,
  mockEnforceCsrfToken,
  mockSendVerificationApprovedEmail,
  mockSendVerificationRejectedEmail,
  mockSendVerificationResubmissionEmail,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockFrom: vi.fn(),
  mockGetUserById: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn<(request: Request) => Response | null>(() => null),
  mockEnforceCsrfToken: vi.fn<(request: Request) => Response | null>(() => null),
  mockSendVerificationApprovedEmail: vi.fn(),
  mockSendVerificationRejectedEmail: vi.fn(),
  mockSendVerificationResubmissionEmail: vi.fn(),
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

vi.mock("@/lib/notifications", () => ({
  createNotification: mockCreateNotification,
}));

vi.mock("@/lib/services/email", () => ({
  sendVerificationApprovedEmail: mockSendVerificationApprovedEmail,
  sendVerificationRejectedEmail: mockSendVerificationRejectedEmail,
  sendVerificationResubmissionEmail: mockSendVerificationResubmissionEmail,
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyStaffActorRoleFromDb: vi.fn(
    async (user: { app_metadata?: Record<string, unknown> } | null | undefined) => {
      const role = user?.app_metadata?.role;
      return role === "admin" || role === "moderator" ? role : null;
    }
  ),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: mockEnforceCsrfToken,
}));

import { POST } from "./route";

// ── Helpers ──────────────────────────────────────────────────

function createMockRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
    headers: new Headers(),
    url: "https://verifymzansi.com/api/admin/verification/decide",
  } as unknown as Request;
}

function createCrossSiteMockRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
    headers: new Headers({ origin: "https://evil.example" }),
    url: "https://verifymzansi.com/api/admin/verification/decide",
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

/** Build a chainable mock for the latest-artifact lookup:
 *  .select().eq().eq().in().order().limit().maybeSingle()
 */
function artifactLookupChain(latestArtifactId = "artifact-1") {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: latestArtifactId } }),
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

/** Build a chainable mock for the artifact status sync update:
 *  .update().eq()
 */
function artifactStatusUpdateChain(resolvedValue = { error: null }) {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(resolvedValue),
    }),
  };
}

/** Build a chainable mock for the purge update:
 *  .update().eq().is()
 */
function artifactPurgeChain(
  resolvedValue: { error: null | { message: string } } = { error: null }
) {
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
    mockCreateAdminClient.mockReturnValue({
      from: mockFrom,
      auth: {
        admin: {
          getUserById: mockGetUserById,
        },
      },
    });
    mockCreateNotification.mockResolvedValue(undefined);
    mockGetUserById.mockResolvedValue({
      data: {
        user: {
          email: "member@example.com",
          user_metadata: { full_name: "Test Member" },
        },
      },
      error: null,
    });
    mockSendVerificationApprovedEmail.mockResolvedValue({ success: true });
    mockSendVerificationRejectedEmail.mockResolvedValue({ success: true });
    mockSendVerificationResubmissionEmail.mockResolvedValue({ success: true });
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockEnforceCsrfToken.mockReturnValue(null);
  });

  it("returns 401 when user is not authenticated", async () => {
    mockAuth(null);
    const response = await POST(createMockRequest({ stepId: STEP_UUID, decision: "approved" }));
    expect(response.status).toBe(401);
  });

  it("returns 403 for cross-site verification decisions", async () => {
    mockEnforceSameOriginMutation.mockReturnValue(
      new Response(JSON.stringify({ error: "Cross-origin request blocked" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );
    const response = await POST(
      createCrossSiteMockRequest({ stepId: STEP_UUID, decision: "approved" })
    );

    expect(response.status).toBe(403);
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

    let artifactLookupReturned = false;
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
        if (!artifactLookupReturned) {
          artifactLookupReturned = true;
          return artifactLookupChain();
        }

        return artifactStatusUpdateChain();
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

    let artifactLookupReturned = false;
    let artifactStatusUpdated = false;
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
            // If selecting first_name / last_name, it's the legal-name propagation fetch
            if (typeof args[0] === "string" && args[0].includes("first_name")) {
              return {
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { first_name: "Test", last_name: "Member" },
                      error: null,
                    }),
                  }),
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
        // First call: artifact lookup; second call: status sync; third call: purge scheduling
        if (!artifactLookupReturned) {
          artifactLookupReturned = true;
          return artifactLookupChain();
        }

        if (!artifactStatusUpdated) {
          artifactStatusUpdated = true;
          return artifactStatusUpdateChain();
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

    let artifactLookupReturned = false;
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
        if (!artifactLookupReturned) {
          artifactLookupReturned = true;
          return artifactLookupChain();
        }

        return artifactStatusUpdateChain();
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
    expect(mockSendVerificationRejectedEmail).toHaveBeenCalledWith(
      "member@example.com",
      "Test Member",
      "The photo is very blurry"
    );
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

    let artifactLookupReturned = false;
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
        if (!artifactLookupReturned) {
          artifactLookupReturned = true;
          return artifactLookupChain();
        }

        return artifactStatusUpdateChain();
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

    let artifactLookupReturned = false;
    let artifactStatusUpdated = false;
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
            // Legal-name propagation fetch
            if (typeof args[0] === "string" && args[0].includes("first_name")) {
              return {
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { first_name: "Test", last_name: "Member" },
                      error: null,
                    }),
                  }),
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
        // First call: artifact lookup; second call: status sync; third call: purge update (fails)
        if (!artifactLookupReturned) {
          artifactLookupReturned = true;
          return artifactLookupChain();
        }

        if (!artifactStatusUpdated) {
          artifactStatusUpdated = true;
          return artifactStatusUpdateChain();
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

    let artifactLookupReturned = false;
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
        if (!artifactLookupReturned) {
          artifactLookupReturned = true;
          return artifactLookupChain();
        }

        return artifactStatusUpdateChain();
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

    let artifactLookupReturned = false;
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
        if (!artifactLookupReturned) {
          artifactLookupReturned = true;
          return artifactLookupChain();
        }

        return artifactStatusUpdateChain();
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
    expect(mockSendVerificationResubmissionEmail).toHaveBeenCalledWith(
      "member@example.com",
      "Test Member",
      "Please retake with better lighting"
    );
  });

  it("returns 409 when approving an ID step already verified by another account", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });

    const idDocStep = {
      ...baseStep,
      id_number_hmac: "hmac-dup-1",
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockImplementation((...args: unknown[]) => {
            if (args[0] === "*") {
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: idDocStep, error: null }),
                }),
              };
            }

            return {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    neq: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        maybeSingle: vi
                          .fn()
                          .mockResolvedValue({ data: { id: "step-other" }, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }),
          update: vi.fn(),
        };
      }

      return {};
    });

    const response = await POST(createMockRequest({ stepId: STEP_UUID, decision: "approved" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This ID number is already linked to another account.",
      code: "id_number_duplicate",
    });
  });

  it("sends verification approved email when an account becomes fully approved", async () => {
    mockAuth({ id: ADMIN_UUID, app_metadata: { role: "admin" } });

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: STEP_UUID }], error: null }),
        }),
      }),
    });

    let artifactLookupReturned = false;
    let artifactStatusUpdated = false;
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
            // Legal-name propagation fetch
            if (typeof args[0] === "string" && args[0].includes("first_name")) {
              return {
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { first_name: "Test", last_name: "Member" },
                      error: null,
                    }),
                  }),
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
        if (!artifactLookupReturned) {
          artifactLookupReturned = true;
          return artifactLookupChain();
        }
        if (!artifactStatusUpdated) {
          artifactStatusUpdated = true;
          return artifactStatusUpdateChain();
        }
        return artifactPurgeChain();
      }
      return {};
    });

    const response = await POST(createMockRequest({ stepId: STEP_UUID, decision: "approved" }));
    expect(response.status).toBe(200);
    expect(mockSendVerificationApprovedEmail).toHaveBeenCalledWith(
      "member@example.com",
      "Test Member"
    );
  });
});

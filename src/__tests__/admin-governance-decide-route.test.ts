import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockVerifyCapabilityRoleFromDb,
  mockApproveDecision,
  mockRejectDecision,
  mockEscalateDecision,
  mockEnforceSameOriginMutation,
  mockEnforceCsrfToken,
  mockCheckLocalRateLimit,
  mockLogApiError,
  mockAdminFrom,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockVerifyCapabilityRoleFromDb: vi.fn(),
  mockApproveDecision: vi.fn(),
  mockRejectDecision: vi.fn(),
  mockEscalateDecision: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn(),
  mockEnforceCsrfToken: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockLogApiError: vi.fn(),
  mockAdminFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyCapabilityRoleFromDb: mockVerifyCapabilityRoleFromDb,
}));

vi.mock("@/lib/services/decision-ledger", () => ({
  approveDecision: mockApproveDecision,
  rejectDecision: mockRejectDecision,
  escalateDecision: mockEscalateDecision,
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: mockEnforceCsrfToken,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...actual,
    logApiError: mockLogApiError,
  };
});

import { POST } from "@/app/api/admin/governance/decide/route";

function createRequest(body: unknown, headers?: HeadersInit) {
  return new Request("http://localhost:3000/api/admin/governance/decide", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/governance/decide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockEnforceCsrfToken.mockReturnValue(null);
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockVerifyCapabilityRoleFromDb.mockResolvedValue("governance_controller");
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "gov-1", app_metadata: { role: "governance_controller" } } },
        }),
      },
    });
    // Default admin mock: decision_records query returns a non-blocking decision
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "decision_records") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { recommender_id: "mod-1", action_category: "report_review" },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    const res = await POST(
      createRequest({
        decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "approve",
        rationale: "Approved",
      })
    );

    expect(res.status).toBe(401);
  });

  it("returns 403 when capability verification fails", async () => {
    mockVerifyCapabilityRoleFromDb.mockResolvedValue(null);

    const res = await POST(
      createRequest({
        decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "approve",
        rationale: "Approved",
      })
    );

    expect(res.status).toBe(403);
  });

  it("uses the DB-verified role for approval records", async () => {
    mockVerifyCapabilityRoleFromDb.mockResolvedValue("admin");
    mockApproveDecision.mockResolvedValue({
      decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      status: "approved",
    });

    const res = await POST(
      createRequest({
        decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "approve",
        rationale: "DB role wins",
      })
    );

    expect(res.status).toBe(200);
    expect(mockApproveDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        approverRole: "admin",
      })
    );
  });

  it("returns 429 when locally rate limited", async () => {
    mockCheckLocalRateLimit.mockReturnValue({ limited: true, retryAfter: 42 });

    const res = await POST(
      createRequest({
        decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "approve",
        rationale: "Approved",
      })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("approves a decision", async () => {
    mockApproveDecision.mockResolvedValue({
      decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      status: "approved",
    });

    const res = await POST(
      createRequest({
        decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "approve",
        rationale: "Meets policy",
        afterState: { enforcement: "suspended" },
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "approved" });
    expect(mockApproveDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        approverId: "gov-1",
        approverRole: "governance_controller",
        rationale: "Meets policy",
        afterState: { enforcement: "suspended" },
      })
    );
  });

  it("rejects a decision", async () => {
    mockRejectDecision.mockResolvedValue({
      decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      status: "rejected",
    });

    const res = await POST(
      createRequest({
        decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "reject",
        rationale: "Insufficient evidence",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "rejected" });
    expect(mockRejectDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        approverId: "gov-1",
        approverRole: "governance_controller",
      })
    );
  });

  it("escalates a decision", async () => {
    mockEscalateDecision.mockResolvedValue({
      decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      status: "escalated",
    });

    const res = await POST(
      createRequest({
        decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "escalate",
        rationale: "Needs senior review",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "escalated" });
    expect(mockEscalateDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "gov-1",
        actorRole: "governance_controller",
        reason: "Needs senior review",
      })
    );
  });

  it("returns 500 when the service throws unexpectedly", async () => {
    mockApproveDecision.mockRejectedValue(new Error("db offline"));

    const res = await POST(
      createRequest({
        decisionId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "approve",
        rationale: "Approved",
      })
    );

    expect(res.status).toBe(500);
    expect(mockLogApiError).toHaveBeenCalled();
  });
});

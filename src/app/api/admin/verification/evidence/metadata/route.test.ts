import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockEnforceCsrfToken,
  mockEnforceSameOriginMutation,
  mockVerifyStaffActorRoleFromDb,
  mockCheckLocalRateLimit,
  mockGetLinkedEvidenceArtifactIds,
  mockLogAuditEvent,
  mockReadAccountVerificationStatus,
  verificationStepSelect,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockEnforceCsrfToken: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn(),
  mockVerifyStaffActorRoleFromDb: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockGetLinkedEvidenceArtifactIds: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockReadAccountVerificationStatus: vi.fn(() => "pending_review"),
  verificationStepSelect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyStaffActorRoleFromDb: (...args: unknown[]) => mockVerifyStaffActorRoleFromDb(...args),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: (...args: unknown[]) => mockCheckLocalRateLimit(...args),
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: (...args: unknown[]) => mockEnforceSameOriginMutation(...args),
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: (...args: unknown[]) => mockEnforceCsrfToken(...args),
}));

vi.mock("@/lib/services/kyc-evidence-access", () => ({
  getLinkedEvidenceArtifactIds: (...args: unknown[]) => mockGetLinkedEvidenceArtifactIds(...args),
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
}));

vi.mock("@/lib/account/compat", async () => {
  const actual = await vi.importActual("@/lib/account/compat");
  return {
    ...actual,
    readAccountVerificationStatus: mockReadAccountVerificationStatus,
  };
});

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET, POST } from "./route";

const STEP_ID = "123e4567-e89b-42d3-a456-426614174000";
const USER_ID = "123e4567-e89b-42d3-a456-426614174111";

function createGetRequest(url: string): NextRequest {
  return {
    nextUrl: new URL(url),
    url,
    headers: {
      get: vi.fn().mockReturnValue(null),
    },
  } as unknown as NextRequest;
}

describe("/api/admin/verification/evidence/metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "admin-1" } },
          error: null,
        }),
      },
    });

    mockVerifyStaffActorRoleFromDb.mockResolvedValue("admin");
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockEnforceCsrfToken.mockReturnValue(null);
    mockGetLinkedEvidenceArtifactIds.mockResolvedValue([]);
    mockLogAuditEvent.mockResolvedValue(undefined);

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "verification_steps") {
          return {
            select: verificationStepSelect.mockImplementation((_columns: string) => ({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: STEP_ID,
                    user_id: USER_ID,
                    step_type: "id_doc",
                    status: "pending",
                    reviewed_at: "2026-03-31T00:00:00.000Z",
                    decided_at: "2026-03-31T00:00:00.000Z",
                    rejection_reason: null,
                  },
                ],
                error: null,
              }),
            })),
          };
        }

        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }

        if (table === "kyc_risk_signals") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }

        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }

        if (table === "kyc_evidence_access_logs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }

        if (table === "kyc_provider_results") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }

        return {};
      }),
    });
  });

  it("uses schema-compatible aliases for legacy step fields", async () => {
    const response = await GET(
      createGetRequest(
        `http://localhost:3000/api/admin/verification/evidence/metadata?stepId=${STEP_ID}`
      )
    );

    expect(response.status).toBe(200);
    expect(verificationStepSelect).toHaveBeenCalled();

    const firstSelectArg = verificationStepSelect.mock.calls[0]?.[0] as string;
    expect(firstSelectArg).toContain("decided_at:reviewed_at");
    expect(firstSelectArg).toContain("rejection_reason:reason_note");

    const payload = await response.json();
    expect(Array.isArray(payload.steps)).toBe(true);
    expect(payload.steps[0]).toMatchObject({
      id: STEP_ID,
      user_id: USER_ID,
      decided_at: "2026-03-31T00:00:00.000Z",
    });
  });

  it("returns 401 when user is not authenticated", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("Unauthorized"),
        }),
      },
    });

    const response = await GET(
      createGetRequest(
        `http://localhost:3000/api/admin/verification/evidence/metadata?stepId=${STEP_ID}`
      )
    );

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.error).toBe("Unauthorized");
    expect(payload.code).toBe("unauthorized");
  });

  it("returns 403 when user does not have staff role", async () => {
    mockVerifyStaffActorRoleFromDb.mockResolvedValue(null);

    const response = await GET(
      createGetRequest(
        `http://localhost:3000/api/admin/verification/evidence/metadata?stepId=${STEP_ID}`
      )
    );

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toBe("Forbidden");
    expect(payload.code).toBe("forbidden");
  });

  it("returns 429 when rate limited", async () => {
    mockCheckLocalRateLimit.mockReturnValue({ limited: true, retryAfter: 60 });

    const response = await GET(
      createGetRequest(
        `http://localhost:3000/api/admin/verification/evidence/metadata?stepId=${STEP_ID}`
      )
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    const payload = await response.json();
    expect(payload.code).toBe("rate_limited");
  });

  it("returns 400 when neither stepId nor userId is provided", async () => {
    const response = await GET(
      createGetRequest("http://localhost:3000/api/admin/verification/evidence/metadata")
    );

    expect(response.status).toBe(400);
  });

  it("returns 403 when no active review case exists for the resolved user", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "verification_steps") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: STEP_ID,
                    user_id: USER_ID,
                    step_type: "id_doc",
                    status: "approved",
                  },
                ],
                error: null,
              }),
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      }),
    });

    const response = await GET(
      createGetRequest(
        `http://localhost:3000/api/admin/verification/evidence/metadata?stepId=${STEP_ID}`
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "no_active_case",
    });
  });

  it("falls back to userId when stepId is stale but userId is supplied", async () => {
    const fallbackSelect = vi.fn();
    fallbackSelect
      .mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      })
      .mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({
          data: [
            {
              id: STEP_ID,
              user_id: USER_ID,
              step_type: "id_doc",
              status: "pending_review",
              reviewed_at: null,
              decided_at: null,
              rejection_reason: null,
            },
          ],
          error: null,
        }),
      });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "verification_steps") {
          return { select: fallbackSelect };
        }

        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }

        if (table === "kyc_risk_signals") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }

        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }

        if (table === "kyc_evidence_access_logs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      }),
    });

    const response = await GET(
      createGetRequest(
        `http://localhost:3000/api/admin/verification/evidence/metadata?stepId=${STEP_ID}&userId=${USER_ID}`
      )
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(fallbackSelect).toHaveBeenCalledTimes(2);
    expect(Array.isArray(payload.steps)).toBe(true);
  });

  it("rejects POST wrapper requests with invalid body before delegating to GET", async () => {
    mockEnforceCsrfToken.mockReturnValue(null);

    const request = {
      url: "http://localhost:3000/api/admin/verification/evidence/metadata",
      headers: new Headers(),
      text: async () => JSON.stringify({}),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(400);
  });
});

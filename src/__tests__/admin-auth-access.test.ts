import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Admin auth access tests — verifies role-based access control
 * across all admin KYC endpoints.
 */

// ── Hoisted mocks ────────────────────────────────────────────

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFrom,
  mockLogAuditEvent,
  mockDownloadKycDocumentWithMetrics,
  mockGetLinkedEvidenceArtifactIds,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockDownloadKycDocumentWithMetrics: vi.fn(),
  mockGetLinkedEvidenceArtifactIds: vi.fn(),
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

vi.mock("@/lib/services/storage", () => ({
  downloadKycDocumentWithMetrics: mockDownloadKycDocumentWithMetrics,
}));

vi.mock("@/lib/services/kyc-evidence-access", () => ({
  getLinkedEvidenceArtifactIds: mockGetLinkedEvidenceArtifactIds,
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
vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));
vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: vi.fn(() => null),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: vi.fn(() => ({ limited: false })),
}));

import { GET as getEvidence } from "@/app/api/admin/verification/evidence/route";
import { POST as postDecide } from "@/app/api/admin/verification/decide/route";

// ── Helpers ──────────────────────────────────────────────────

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

function createMockNextRequest(
  url: string,
  options?: { method?: string; body?: Record<string, unknown> }
) {
  const nextUrl = new URL(url, "http://localhost:3000");

  const req = {
    nextUrl,
    headers: {
      get: vi.fn().mockReturnValue(null),
    },
    text: async () => JSON.stringify(options?.body ?? {}),
    json: async () => options?.body ?? {},
    method: options?.method ?? "GET",
  } as unknown as NextRequest;

  return req;
}

// ── Tests ────────────────────────────────────────────────────

describe("Admin auth access control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ from: mockFrom });
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockGetLinkedEvidenceArtifactIds.mockResolvedValue(["art-1"]);
    mockDownloadKycDocumentWithMetrics.mockResolvedValue({
      buffer: Buffer.from("test"),
      downloadMs: 1,
      decryptMs: 1,
    });
  });

  describe("Evidence endpoint (GET /api/admin/verification/evidence)", () => {
    it("returns 401 for unauthenticated requests", async () => {
      mockAuth(null);
      const res = await getEvidence(
        createMockNextRequest(
          "http://localhost:3000/api/admin/verification/evidence?artifactId=00000000-0000-0000-0000-000000000001"
        )
      );
      expect(res.status).toBe(401);
    });

    it("returns 403 for legacy seller role", async () => {
      mockAuth({ id: "seller-1", app_metadata: { role: "seller" } });
      const res = await getEvidence(
        createMockNextRequest(
          "http://localhost:3000/api/admin/verification/evidence?artifactId=00000000-0000-0000-0000-000000000001"
        )
      );
      expect(res.status).toBe(403);
    });

    it("returns 403 for buyer role", async () => {
      mockAuth({ id: "buyer-1", app_metadata: { role: "buyer" } });
      const res = await getEvidence(
        createMockNextRequest(
          "http://localhost:3000/api/admin/verification/evidence?artifactId=00000000-0000-0000-0000-000000000001"
        )
      );
      expect(res.status).toBe(403);
    });

    it("returns 403 for user with no role", async () => {
      mockAuth({ id: "user-1", app_metadata: {} });
      const res = await getEvidence(
        createMockNextRequest(
          "http://localhost:3000/api/admin/verification/evidence?artifactId=00000000-0000-0000-0000-000000000001"
        )
      );
      expect(res.status).toBe(403);
    });

    it("allows admin role", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });
      mockFrom.mockImplementation((table: string) => {
        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: "art-1",
                    user_id: "seller-1",
                    r2_key: "dev://test",
                    content_type: "image/jpeg",
                    artifact_kind: "id_doc",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "verification_steps") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ count: 1, error: null }),
              }),
            }),
          };
        }
        if (table === "verification_sessions") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id_artifact_id: "art-1",
                    selfie_artifact_id: null,
                    location_submitted_at: null,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "kyc_evidence_access_logs") {
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }
        return {};
      });
      const res = await getEvidence(
        createMockNextRequest(
          "http://localhost:3000/api/admin/verification/evidence?artifactId=00000000-0000-0000-0000-000000000001"
        )
      );
      expect(res.status).toBe(200);
    });

    it("allows moderator role", async () => {
      mockAuth({ id: "mod-1", app_metadata: { role: "moderator" } });
      mockFrom.mockImplementation((table: string) => {
        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: "art-1",
                    user_id: "seller-1",
                    r2_key: "dev://test",
                    content_type: "image/jpeg",
                    artifact_kind: "id_doc",
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "verification_steps") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ count: 1, error: null }),
              }),
            }),
          };
        }
        if (table === "verification_sessions") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id_artifact_id: "art-1",
                    selfie_artifact_id: null,
                    location_submitted_at: null,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "kyc_evidence_access_logs") {
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }
        return {};
      });
      const res = await getEvidence(
        createMockNextRequest(
          "http://localhost:3000/api/admin/verification/evidence?artifactId=00000000-0000-0000-0000-000000000001"
        )
      );
      expect(res.status).toBe(200);
    });
  });

  describe("Decide endpoint (POST /api/admin/verification/decide)", () => {
    it("returns 401 for unauthenticated requests", async () => {
      mockAuth(null);
      const res = await postDecide(
        createMockNextRequest("http://localhost:3000/api/admin/verification/decide", {
          method: "POST",
          body: { stepId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", decision: "approved" },
        })
      );
      expect(res.status).toBe(401);
    });

    it("returns 403 for legacy seller role", async () => {
      mockAuth({ id: "seller-1", app_metadata: { role: "seller" } });
      const res = await postDecide(
        createMockNextRequest("http://localhost:3000/api/admin/verification/decide", {
          method: "POST",
          body: { stepId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", decision: "approved" },
        })
      );
      expect(res.status).toBe(403);
    });

    it("returns 403 for buyer role", async () => {
      mockAuth({ id: "buyer-1", app_metadata: { role: "buyer" } });
      const res = await postDecide(
        createMockNextRequest("http://localhost:3000/api/admin/verification/decide", {
          method: "POST",
          body: { stepId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", decision: "approved" },
        })
      );
      expect(res.status).toBe(403);
    });

    it("allows admin role past auth check", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });
      // Will fail on validation (missing stepId UUID format) — but not 401/403
      const res = await postDecide(
        createMockNextRequest("http://localhost:3000/api/admin/verification/decide", {
          method: "POST",
          body: { stepId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", decision: "approved" },
        })
      );
      // Should get past auth — could be 400 (validation) or 404 (step not found), not 401/403
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it("allows moderator role past auth check", async () => {
      mockAuth({ id: "mod-1", app_metadata: { role: "moderator" } });
      const res = await postDecide(
        createMockNextRequest("http://localhost:3000/api/admin/verification/decide", {
          method: "POST",
          body: { stepId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", decision: "approved" },
        })
      );
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });
});

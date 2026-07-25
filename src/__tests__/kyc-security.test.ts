import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Security tests for the KYC system:
 * - Cross-user evidence access prevention
 * - Evidence endpoint hardening (security headers)
 * - Upload route cross-user protection
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

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock("@/lib/auth/admin-access", () => ({
  verifyStaffActorRoleFromDb: vi.fn(
    async (user: { app_metadata?: Record<string, unknown> } | null | undefined) => {
      const role = user?.app_metadata?.role;
      return role === "admin" || role === "moderator" ? role : null;
    }
  ),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: vi.fn(() => ({ limited: false })),
}));

import { GET as getEvidence } from "@/app/api/admin/verification/evidence/route";

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

function createMockNextRequest(url: string) {
  const nextUrl = new URL(url, "http://localhost:3000");
  return {
    nextUrl,
    headers: {
      get: vi.fn().mockImplementation((name: string) => {
        if (name === "x-forwarded-for") return "192.168.1.100";
        return null;
      }),
    },
  } as unknown as NextRequest;
}

// ── Tests ────────────────────────────────────────────────────

describe("KYC Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ from: mockFrom });
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockGetLinkedEvidenceArtifactIds.mockResolvedValue(["art-1"]);
    mockDownloadKycDocumentWithMetrics.mockResolvedValue({
      buffer: Buffer.from("fake-image-data"),
      downloadMs: 1,
      decryptMs: 1,
    });
  });

  describe("Evidence endpoint security headers", () => {
    it("sets no-cache, no-store headers on evidence response", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });
      mockDownloadKycDocumentWithMetrics.mockResolvedValue({
        buffer: Buffer.from("fake-image-data"),
        downloadMs: 1,
        decryptMs: 1,
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: "art-1",
                    user_id: "seller-1",
                    r2_key: "kyc/seller-1/id_doc.enc",
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
      expect(res.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Content-Disposition")).toBe("inline");
    });

    it("includes CSP header restricting to self images only", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });
      mockDownloadKycDocumentWithMetrics.mockResolvedValue({
        buffer: Buffer.from("fake-image-data"),
        downloadMs: 1,
        decryptMs: 1,
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: "art-1",
                    user_id: "seller-1",
                    r2_key: "kyc/seller-1/selfie.enc",
                    content_type: "image/png",
                    artifact_kind: "selfie",
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

      expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
      expect(res.headers.get("Content-Security-Policy")).toContain("img-src 'self'");
    });
  });

  describe("Evidence access logging", () => {
    it("logs evidence access with hashed IP", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });

      const insertMock = vi.fn().mockResolvedValue({ error: null });

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
          return { insert: insertMock };
        }
        return {};
      });

      await getEvidence(
        createMockNextRequest(
          "http://localhost:3000/api/admin/verification/evidence?artifactId=00000000-0000-0000-0000-000000000001"
        )
      );

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: "admin-1",
          actor_role: "admin",
          artifact_id: "art-1",
          user_id: "seller-1",
          ip_hash: expect.any(String),
        })
      );

      // IP should be hashed, not raw
      const loggedIpHash = insertMock.mock.calls[0][0].ip_hash;
      expect(loggedIpHash).not.toBe("192.168.1.100");
      expect(loggedIpHash.length).toBeGreaterThan(0);
    });
  });

  describe("Artifact not found", () => {
    it("returns 404 for non-existent artifact", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });

      mockFrom.mockImplementation((table: string) => {
        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
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
          "http://localhost:3000/api/admin/verification/evidence?artifactId=00000000-0000-0000-0000-000000000099"
        )
      );
      expect(res.status).toBe(404);
    });
  });

  describe("Missing artifactId parameter", () => {
    it("returns 400 when artifactId is missing", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });

      const res = await getEvidence(
        createMockNextRequest("http://localhost:3000/api/admin/verification/evidence")
      );
      expect(res.status).toBe(400);
    });
  });

  describe("Download/decrypt failure handling", () => {
    it("returns 500 when R2 download fails", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });
      mockDownloadKycDocumentWithMetrics.mockRejectedValue(new Error("Decrypt failed"));

      mockFrom.mockImplementation((table: string) => {
        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: "art-1",
                    user_id: "seller-1",
                    r2_key: "kyc/seller-1/id_doc.enc",
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
      expect(res.status).toBe(500);
    });
  });

  describe("Dev mode artifact", () => {
    it("returns placeholder text for dev:// r2_key", async () => {
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
                    r2_key: "dev://test-artifact",
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
      expect(res.headers.get("Content-Type")).toBe("text/plain");
      // Should NOT call downloadKycDocument for dev:// keys
      expect(mockDownloadKycDocumentWithMetrics).not.toHaveBeenCalled();
    });
  });

  describe("Session-bound artifact access", () => {
    it("denies access when the artifact is not linked to the active verification session", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });
      mockGetLinkedEvidenceArtifactIds.mockResolvedValue([]);
      mockDownloadKycDocumentWithMetrics.mockResolvedValue({
        buffer: Buffer.from("fake-image-data"),
        downloadMs: 1,
        decryptMs: 1,
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: "art-99",
                    user_id: "seller-1",
                    r2_key: "kyc/seller-1/old-id.enc",
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

      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({
        code: "artifact_not_linked",
      });
      expect(mockDownloadKycDocumentWithMetrics).not.toHaveBeenCalled();
    });
  });
});

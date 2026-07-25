import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Tests for GET /api/admin/verification/evidence/metadata
 * Covers: auth, validation, 404, happy path, audit logging.
 */

// ── Hoisted mocks ────────────────────────────────────────────

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFrom,
  mockLogAuditEvent,
  mockGetLinkedEvidenceArtifactIds,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
  mockLogAuditEvent: vi.fn(),
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

import { GET } from "@/app/api/admin/verification/evidence/metadata/route";

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
      get: vi.fn().mockReturnValue(null),
    },
  } as unknown as NextRequest;
}

// Mock data
const MOCK_STEP = {
  id: "step-1",
  user_id: "seller-1",
  step_type: "id_doc",
  status: "pending_review",
  risk_level: "low",
  risk_score: 10,
  created_at: "2025-01-01T00:00:00Z",
};

const MOCK_ARTIFACT = {
  id: "art-1",
  user_id: "seller-1",
  step_type: "id_doc",
  artifact_kind: "id_doc",
  r2_key: "kyc/seller-1/id_doc.enc",
  content_type: "image/jpeg",
  file_size_bytes: 1024,
  sha256: "abc123",
  provider_ref: null,
  purge_after: null,
  status: "active",
  created_at: "2025-01-01T00:00:00Z",
};

const MOCK_SELLER_PROFILE = {
  display_name: "Test Account",
  account_verification_status: "pending_review",
  account_status: "active",
  strikes: 0,
  legal_hold: false,
  location_province: "Gauteng",
  location_city: "Johannesburg",
};

// Matches the real kyc_risk_signals schema
// (supabase/migrations/20260224000000_kyc_fraud_resistant_schema.sql)
const MOCK_RISK_SIGNAL = {
  id: "signal-1",
  user_id: "seller-1",
  artifact_id: "art-1",
  signal_code: "duplicate_sha256",
  severity: "block",
  value_json: { matchingArtifactId: "art-9" },
  created_at: "2025-01-02T00:00:00Z",
};

// Matches the real kyc_provider_results schema
const MOCK_PROVIDER_RESULT = {
  id: "pr-1",
  artifact_id: "art-1",
  provider_name: "stub",
  provider_status: "approved",
  face_match_score: 95,
  liveness_score: 90,
  doc_auth_score: 85,
  provider_ref: "sim_rev_123",
  created_at: "2025-01-02T00:00:00Z",
};

// ── Chainable query builder stub ─────────────────────────────

function chainStub(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const _handler = () => chain;
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data, error });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  // For non-.single() calls, make the chain itself thenable
  chain.then = (resolve: (v: unknown) => void) => resolve({ data, error });
  return chain;
}

// ── Tests ────────────────────────────────────────────────────

describe("Evidence Metadata API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLinkedEvidenceArtifactIds.mockResolvedValue(["art-1"]);
    mockCreateAdminClient.mockReturnValue({
      from: mockFrom,
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { app_metadata: { role: "admin" } } },
            error: null,
          }),
        },
      },
    });
    mockLogAuditEvent.mockResolvedValue(undefined);
  });

  // ── Auth ───────────────────────────────────────────────────

  describe("Authentication & Authorization", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuth(null);

      const res = await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?stepId=00000000-0000-0000-0000-000000000010"
        )
      );
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
      expect(body.code).toBe("unauthorized");
    });

    it("returns 403 for a non-admin/moderator role", async () => {
      mockAuth({ id: "seller-1", app_metadata: { role: "seller" } });

      const res = await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?stepId=00000000-0000-0000-0000-000000000010"
        )
      );
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error).toBe("Forbidden");
      expect(body.code).toBe("forbidden");
    });

    it("returns 403 when role is missing", async () => {
      mockAuth({ id: "user-1", app_metadata: {} });

      const res = await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?stepId=00000000-0000-0000-0000-000000000010"
        )
      );
      expect(res.status).toBe(403);
    });
  });

  // ── Validation ─────────────────────────────────────────────

  describe("Parameter validation", () => {
    it("returns 400 when neither stepId nor userId is provided", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });

      const res = await GET(createMockNextRequest("/api/admin/verification/evidence/metadata"));
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBe("Invalid evidence metadata query");
    });
  });

  // ── Not found ──────────────────────────────────────────────

  describe("Step not found", () => {
    it("returns 404 when verification step does not exist", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });

      mockFrom.mockImplementation((table: string) => {
        if (table === "verification_steps") {
          return chainStub(null, { code: "PGRST116" });
        }
        return chainStub([]);
      });

      const res = await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?stepId=00000000-0000-0000-0000-000000000099"
        )
      );
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toContain("not found");
      expect(body.code).toBe("not_found");
    });

    it("returns 200 with empty artifacts when the active verification session has no linked artifacts", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });
      mockGetLinkedEvidenceArtifactIds.mockResolvedValue([]);

      mockFrom.mockImplementation((table: string) => {
        switch (table) {
          case "verification_steps":
            return chainStub([MOCK_STEP]);
          case "verification_sessions":
            return chainStub({
              id_artifact_id: null,
              selfie_artifact_id: null,
              location_submitted_at: null,
            });
          default:
            return chainStub([]);
        }
      });

      const res = await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?stepId=00000000-0000-0000-0000-000000000010"
        )
      );

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.artifacts).toEqual([]);
    });
  });

  // ── Happy path (by stepId) ─────────────────────────────────

  describe("Happy path", () => {
    it("returns full metadata bundle when queried by stepId", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });

      mockFrom.mockImplementation((table: string) => {
        switch (table) {
          case "verification_steps":
            return chainStub([MOCK_STEP]);
          case "verification_sessions":
            return chainStub({
              id_artifact_id: "art-1",
              selfie_artifact_id: null,
              location_submitted_at: null,
            });
          case "kyc_artifacts":
            return chainStub([MOCK_ARTIFACT]);
          case "kyc_provider_results":
            return chainStub([MOCK_PROVIDER_RESULT]);
          case "kyc_risk_signals":
            return chainStub([MOCK_RISK_SIGNAL]);
          case "account_profiles":
            return chainStub(MOCK_SELLER_PROFILE);
          case "kyc_evidence_access_logs":
            return chainStub([]);
          default:
            return chainStub([]);
        }
      });

      const res = await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?stepId=00000000-0000-0000-0000-000000000010"
        )
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.steps).toHaveLength(1);
      expect(body.steps[0].id).toBe("step-1");
      expect(body.artifacts).toHaveLength(1);
      expect(body.artifacts[0].id).toBe("art-1");
      expect(body.accountProfile.display_name).toBe("Test Account");
      expect(body.accountProfile.account_verification_status).toBe("pending_review");
      expect(body.sellerProfile.display_name).toBe("Test Account");
      expect(body.riskSignals).toEqual([
        expect.objectContaining({
          signal_code: "duplicate_sha256",
          severity: "block",
          value_json: { matchingArtifactId: "art-9" },
        }),
      ]);
      expect(body.providerResults).toEqual([
        expect.objectContaining({
          provider_name: "stub",
          provider_status: "approved",
          face_match_score: 95,
          liveness_score: 90,
          doc_auth_score: 85,
          provider_ref: "sim_rev_123",
        }),
      ]);
      expect(body.accessLog).toEqual([]);
    });

    it("requests provider results with the real kyc_provider_results columns", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });

      let providerSelectArg: string | null = null;
      mockFrom.mockImplementation((table: string) => {
        switch (table) {
          case "verification_steps":
            return chainStub([MOCK_STEP]);
          case "verification_sessions":
            return chainStub({
              id_artifact_id: "art-1",
              selfie_artifact_id: null,
              location_submitted_at: null,
            });
          case "kyc_artifacts":
            return chainStub([MOCK_ARTIFACT]);
          case "kyc_provider_results": {
            const chain = chainStub([MOCK_PROVIDER_RESULT]);
            chain.select = vi.fn((columns: string) => {
              providerSelectArg = columns;
              return chain;
            });
            return chain;
          }
          case "kyc_risk_signals":
            return chainStub([MOCK_RISK_SIGNAL]);
          case "account_profiles":
            return chainStub(MOCK_SELLER_PROFILE);
          case "kyc_evidence_access_logs":
            return chainStub([]);
          default:
            return chainStub([]);
        }
      });

      const res = await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?stepId=00000000-0000-0000-0000-000000000010"
        )
      );
      expect(res.status).toBe(200);

      expect(providerSelectArg).not.toBeNull();
      expect(providerSelectArg).toContain("provider_name");
      expect(providerSelectArg).toContain("provider_status");
      expect(providerSelectArg).toContain("face_match_score");
      expect(providerSelectArg).toContain("liveness_score");
      expect(providerSelectArg).toContain("doc_auth_score");
      expect(providerSelectArg).toContain("provider_ref");
      expect(providerSelectArg).not.toContain("normalized_decision");
      expect(providerSelectArg).not.toContain("check_type");
      expect(providerSelectArg).not.toContain("raw_status");
    });

    it("requests risk signals with the real kyc_risk_signals columns", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });

      let riskSignalSelectArg: string | null = null;
      mockFrom.mockImplementation((table: string) => {
        switch (table) {
          case "verification_steps":
            return chainStub([MOCK_STEP]);
          case "verification_sessions":
            return chainStub({
              id_artifact_id: "art-1",
              selfie_artifact_id: null,
              location_submitted_at: null,
            });
          case "kyc_artifacts":
            return chainStub([MOCK_ARTIFACT]);
          case "kyc_provider_results":
            return chainStub([MOCK_PROVIDER_RESULT]);
          case "kyc_risk_signals": {
            const chain = chainStub([MOCK_RISK_SIGNAL]);
            chain.select = vi.fn((columns: string) => {
              riskSignalSelectArg = columns;
              return chain;
            });
            return chain;
          }
          case "account_profiles":
            return chainStub(MOCK_SELLER_PROFILE);
          case "kyc_evidence_access_logs":
            return chainStub([]);
          default:
            return chainStub([]);
        }
      });

      const res = await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?stepId=00000000-0000-0000-0000-000000000010"
        )
      );
      expect(res.status).toBe(200);

      expect(riskSignalSelectArg).not.toBeNull();
      expect(riskSignalSelectArg).toContain("signal_code");
      expect(riskSignalSelectArg).toContain("severity");
      expect(riskSignalSelectArg).toContain("value_json");
      expect(riskSignalSelectArg).not.toContain("signal_type");
      expect(riskSignalSelectArg).not.toContain("signal_key");
      expect(riskSignalSelectArg).not.toContain("detail");
    });

    it("returns metadata when queried by userId", async () => {
      mockAuth({ id: "mod-1", app_metadata: { role: "moderator" } });

      mockFrom.mockImplementation((table: string) => {
        switch (table) {
          case "verification_steps":
            return chainStub([MOCK_STEP]);
          case "verification_sessions":
            return chainStub({
              id_artifact_id: "art-1",
              selfie_artifact_id: null,
              location_submitted_at: null,
            });
          case "kyc_artifacts":
            return chainStub([MOCK_ARTIFACT]);
          case "kyc_provider_results":
            return chainStub([]);
          case "kyc_risk_signals":
            return chainStub([]);
          case "account_profiles":
            return chainStub(MOCK_SELLER_PROFILE);
          case "kyc_evidence_access_logs":
            return chainStub([]);
          default:
            return chainStub([]);
        }
      });

      const res = await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?userId=00000000-0000-0000-0000-000000000020"
        )
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.steps).toHaveLength(1);
    });
  });

  // ── Audit logging ──────────────────────────────────────────

  describe("Audit logging", () => {
    it("logs kyc_evidence_viewed event on successful access", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });

      mockFrom.mockImplementation((table: string) => {
        switch (table) {
          case "verification_steps":
            return chainStub([MOCK_STEP]);
          case "verification_sessions":
            return chainStub({
              id_artifact_id: "art-1",
              selfie_artifact_id: null,
              location_submitted_at: null,
            });
          case "kyc_artifacts":
            return chainStub([MOCK_ARTIFACT]);
          case "kyc_provider_results":
            return chainStub([]);
          case "kyc_risk_signals":
            return chainStub([]);
          case "account_profiles":
            return chainStub(MOCK_SELLER_PROFILE);
          case "kyc_evidence_access_logs":
            return chainStub([]);
          default:
            return chainStub([]);
        }
      });

      await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?stepId=00000000-0000-0000-0000-000000000010"
        )
      );

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: "admin-1",
          actorRole: "admin",
          action: "kyc_evidence_viewed",
          targetType: "verification_step",
          targetId: "00000000-0000-0000-0000-000000000010",
          metadata: expect.objectContaining({
            viewed_user_id: "seller-1",
            step_count: 1,
            artifact_count: 1,
          }),
        })
      );
    });

    it("does not log audit event when auth fails", async () => {
      mockAuth(null);

      await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?stepId=00000000-0000-0000-0000-000000000010"
        )
      );

      expect(mockLogAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe("Session-bound metadata", () => {
    it("returns no artifacts when the current verification session links none", async () => {
      mockAuth({ id: "admin-1", app_metadata: { role: "admin" } });
      mockGetLinkedEvidenceArtifactIds.mockResolvedValue([]);

      mockFrom.mockImplementation((table: string) => {
        switch (table) {
          case "verification_steps":
            return chainStub([MOCK_STEP]);
          case "verification_sessions":
            return chainStub({
              id_artifact_id: null,
              selfie_artifact_id: null,
              location_submitted_at: null,
            });
          case "kyc_artifacts":
            return chainStub([MOCK_ARTIFACT]);
          case "kyc_provider_results":
            return chainStub([]);
          case "kyc_risk_signals":
            return chainStub([]);
          case "account_profiles":
            return chainStub(MOCK_SELLER_PROFILE);
          case "kyc_evidence_access_logs":
            return chainStub([]);
          default:
            return chainStub([]);
        }
      });

      const res = await GET(
        createMockNextRequest(
          "/api/admin/verification/evidence/metadata?stepId=00000000-0000-0000-0000-000000000010"
        )
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.artifacts).toHaveLength(1);
      expect(body.artifacts[0].id).toBe("art-1");
    });
  });
});

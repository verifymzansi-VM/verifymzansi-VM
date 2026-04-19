/**
 * Minimal tests for GET /api/admin/verification/evidence
 *
 * Focus: Fix 7 — when the POPIA audit log insert fails, the response must
 * carry the `X-Audit-Warning: log-failed` header so the admin UI can surface
 * the compliance gap without blocking the evidence review.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockCreateClient, mockCreateAdminClient, mockVerifyStaffRole, mockLinkedArtifactIds } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockVerifyStaffRole: vi.fn(),
    mockLinkedArtifactIds: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/auth/admin-access", () => ({
  verifyStaffActorRoleFromDb: mockVerifyStaffRole,
}));
vi.mock("@/lib/services/kyc-evidence-access", () => ({
  getLinkedEvidenceArtifactIds: mockLinkedArtifactIds,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: () => ({ limited: false }),
  checkRateLimit: () => Promise.resolve({ limited: false }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
// downloadKycDocumentWithMetrics is only called for non-dev paths; not needed here.
vi.mock("@/lib/services/storage", () => ({
  downloadKycDocumentWithMetrics: vi.fn().mockRejectedValue(new Error("not mocked")),
}));

import { GET } from "@/app/api/admin/verification/evidence/route";

const ACTOR_ID = "actor-admin-001";
const ARTIFACT_ID = "00000000-0000-0000-0000-000000000001";
const DEV_R2_KEY = "dev://iddoc/test-image.jpg";

function makeGetRequest(artifactId = ARTIFACT_ID): NextRequest {
  const url = new URL(`http://localhost/api/admin/verification/evidence?artifactId=${artifactId}`);
  return {
    method: "GET",
    url: url.href,
    nextUrl: url,
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

function makeArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: ARTIFACT_ID,
    user_id: "target-user-001",
    r2_key: DEV_R2_KEY,
    content_type: "image/jpeg",
    artifact_kind: "id_document",
    step_type: "identity",
    status: "pending_review",
    ...overrides,
  };
}

/** Build a minimal admin client mock that supports the happy-path DB calls. */
function makeAdminClient(opts: {
  accessLogError?: { message: string } | null;
  artifactOverrides?: Record<string, unknown>;
}) {
  const artifact = makeArtifact(opts.artifactOverrides ?? {});

  return {
    from: vi.fn((table: string) => {
      switch (table) {
        case "kyc_artifacts":
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: artifact, error: null }),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
          };

        case "verification_steps":
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            // .in() is the last call; route awaits the result directly
            in: vi.fn().mockResolvedValue({ count: 1, error: null }),
          };

        case "kyc_evidence_access_logs":
          return {
            insert: vi.fn().mockResolvedValue({ error: opts.accessLogError ?? null, data: null }),
          };

        default:
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
      }
    }),
  };
}

describe("GET /api/admin/verification/evidence — X-Audit-Warning header", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: ACTOR_ID } },
          error: null,
        }),
      },
    });
    mockVerifyStaffRole.mockResolvedValue("admin");
    mockLinkedArtifactIds.mockResolvedValue([ARTIFACT_ID]);
  });

  // ── dev:// path: audit log succeeds ────────────────────────────────

  it("returns 200 without X-Audit-Warning when audit log insert succeeds (dev path)", async () => {
    mockCreateAdminClient.mockReturnValue(makeAdminClient({ accessLogError: null }));

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Audit-Warning")).toBeNull();
  });

  // ── dev:// path: audit log fails ─────────────────────────────────

  it("returns 200 with X-Audit-Warning: log-failed when audit log insert errors (dev path)", async () => {
    // Fix 7: POPIA compliance — admin UI gets a signal that the access was not logged.
    mockCreateAdminClient.mockReturnValue(
      makeAdminClient({ accessLogError: { message: "kyc_evidence_access_logs insert error" } })
    );

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Audit-Warning")).toBe("log-failed");
  });

  // ── auth guard ───────────────────────────────────────────────────

  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: { message: "no session" } }),
      },
    });

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(401);
  });

  it("returns 403 when actor does not have a staff role", async () => {
    mockVerifyStaffRole.mockResolvedValue(null);

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(403);
  });

  // ── artifact not found ───────────────────────────────────────────

  it("returns 404 when the artifact record does not exist", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
          };
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
      }),
    });

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(404);
  });
});

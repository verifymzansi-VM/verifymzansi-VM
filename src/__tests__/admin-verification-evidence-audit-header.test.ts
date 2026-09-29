/**
 * Minimal tests for GET /api/admin/verification/evidence
 *
 * Focus: POPIA audit trail. When the kyc_evidence_access_logs insert fails the
 * route fails closed with 503 — identity documents are never served without a
 * record of who viewed them (previously it served the document with an
 * `X-Audit-Warning: log-failed` header).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockVerifyStaffRole,
  mockLinkedArtifactIds,
  mockDownloadKycDocument,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockVerifyStaffRole: vi.fn(),
  mockLinkedArtifactIds: vi.fn(),
  mockDownloadKycDocument: vi.fn(),
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
vi.mock("@/lib/services/storage", () => ({
  downloadKycDocumentWithMetrics: (...args: unknown[]) => mockDownloadKycDocument(...args),
}));

import { GET } from "@/app/api/admin/verification/evidence/route";

const ACTOR_ID = "actor-admin-001";
const ARTIFACT_ID = "00000000-0000-0000-0000-000000000001";
const DEV_R2_KEY = "dev://iddoc/test-image.jpg";
const STORED_R2_KEY = "kyc/id_doc/target-user-001/file.bin";
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

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

describe("GET /api/admin/verification/evidence — audit log fails closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDownloadKycDocument.mockReset();
    mockDownloadKycDocument.mockResolvedValue({ buffer: JPEG_BYTES, downloadMs: 1, decryptMs: 1 });

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

  // ── audit log succeeds ───────────────────────────────────────────

  it("returns 200 without X-Audit-Warning when audit log insert succeeds (dev path)", async () => {
    mockCreateAdminClient.mockReturnValue(makeAdminClient({ accessLogError: null }));

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Audit-Warning")).toBeNull();
  });

  // ── audit log fails ──────────────────────────────────────────────

  it("fails closed with 503 and serves no document when audit log insert errors (dev path)", async () => {
    mockCreateAdminClient.mockReturnValue(
      makeAdminClient({ accessLogError: { message: "kyc_evidence_access_logs insert error" } })
    );

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("X-Audit-Warning")).toBeNull();
    const body = await response.json();
    expect(body).toMatchObject({ code: "server_error" });
    expect(JSON.stringify(body)).not.toContain("Development mode");
  });

  it("fails closed with 503 before downloading stored evidence when audit log insert errors", async () => {
    mockCreateAdminClient.mockReturnValue(
      makeAdminClient({
        accessLogError: { message: "kyc_evidence_access_logs insert error" },
        artifactOverrides: { r2_key: STORED_R2_KEY },
      })
    );

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "server_error" });
    // No document bytes are fetched, decrypted or served.
    expect(mockDownloadKycDocument).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Disposition")).toBeNull();
  });

  it("serves stored evidence when the audit log insert succeeds", async () => {
    mockCreateAdminClient.mockReturnValue(
      makeAdminClient({ accessLogError: null, artifactOverrides: { r2_key: STORED_R2_KEY } })
    );

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(200);
    expect(mockDownloadKycDocument).toHaveBeenCalledWith(STORED_R2_KEY);
    expect(Buffer.from(await response.arrayBuffer()).equals(JPEG_BYTES)).toBe(true);
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

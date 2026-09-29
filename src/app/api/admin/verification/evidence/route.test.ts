import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockVerifyStaffActorRoleFromDb,
  mockCheckLocalRateLimit,
  mockDownloadKycDocument,
  mockGetLinkedEvidenceArtifactIds,
  mockEnforceSameOriginMutation,
  mockEnforceCsrfToken,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockVerifyStaffActorRoleFromDb: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockDownloadKycDocument: vi.fn(),
  mockGetLinkedEvidenceArtifactIds: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn<(request: unknown, log?: unknown) => null>(() => null),
  mockEnforceCsrfToken: vi.fn<(request: unknown, log?: unknown) => null>(() => null),
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

vi.mock("@/lib/services/storage", () => ({
  downloadKycDocumentWithMetrics: (...args: unknown[]) => mockDownloadKycDocument(...args),
}));

vi.mock("@/lib/services/kyc-evidence-access", () => ({
  getLinkedEvidenceArtifactIds: (...args: unknown[]) => mockGetLinkedEvidenceArtifactIds(...args),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: (request: unknown, log?: unknown) =>
    mockEnforceSameOriginMutation(request, log),
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: (request: unknown, log?: unknown) => mockEnforceCsrfToken(request, log),
}));

import { GET, POST } from "./route";

// ── Fixtures ─────────────────────────────────────────────────

/** Real magic bytes so the route's content sniffing sees genuine files. */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "latin1"),
]);
const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n", "latin1");
const HTML_BYTES = Buffer.from("<html><script>alert(1)</script></html>", "latin1");

const EVIDENCE_URL =
  "http://localhost:3000/api/admin/verification/evidence?artifactId=123e4567-e89b-42d3-a456-426614174000";
const EVIDENCE_CSP = "default-src 'none'; img-src 'self'; sandbox";

// ── Helpers ──────────────────────────────────────────────────

function createGetRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return {
    nextUrl: new URL(url),
    url,
    headers: {
      get: vi.fn((name: string) => headers[name.toLowerCase()] ?? null),
    },
  } as unknown as NextRequest;
}

function createPostRequest(body: unknown): NextRequest {
  return {
    url: "http://localhost:3000/api/admin/verification/evidence",
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as NextRequest;
}

function createVerificationStepsBuilder(count = 1) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ count, error: null }),
  };
}

function createAccessLogsBuilder(
  insert: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ error: null })
) {
  return { insert };
}

function makeArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    user_id: "user-1",
    r2_key: "kyc/id_document/user-1/file.bin",
    content_type: "image/jpeg",
    artifact_kind: "document",
    step_type: "id_doc",
    ...overrides,
  };
}

/**
 * Admin client serving a single artifact row. Any further kyc_artifacts lookup
 * would return another same-step artifact, so a test can prove the route never
 * substitutes one.
 */
function mockAdminClientForArtifact(
  artifact: Record<string, unknown>,
  opts: { activeStepCount?: number; accessLogInsert?: ReturnType<typeof vi.fn> } = {}
) {
  let artifactLookups = 0;
  const from = vi.fn((table: string) => {
    if (table === "kyc_artifacts") {
      artifactLookups += 1;
      if (artifactLookups === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: artifact, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [
              {
                id: "artifact-2",
                r2_key: "kyc/id_document/user-1/other.bin",
                created_at: "2026-03-27T09:30:00Z",
              },
            ],
            error: null,
          }),
        }),
      };
    }

    if (table === "verification_steps") {
      return createVerificationStepsBuilder(opts.activeStepCount ?? 1);
    }

    if (table === "kyc_evidence_access_logs") {
      return createAccessLogsBuilder(opts.accessLogInsert);
    }

    throw new Error(`Unexpected table lookup: ${table}`);
  });
  mockCreateAdminClient.mockReturnValue({ from });
  return {
    from,
    artifactLookupCount: () => artifactLookups,
  };
}

function mockDownloadResult(buffer: Buffer) {
  mockDownloadKycDocument.mockResolvedValue({ buffer, downloadMs: 4, decryptMs: 6 });
}

describe("/api/admin/verification/evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps queued *Once implementations; reset so none leak between tests.
    mockDownloadKycDocument.mockReset();
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
    mockGetLinkedEvidenceArtifactIds.mockResolvedValue(["artifact-1", "artifact-2"]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 400 for an invalid artifactId query", async () => {
    const response = await GET(
      createGetRequest("http://localhost:3000/api/admin/verification/evidence?artifactId=bad-id")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "artifactId query parameter is required",
    });
  });

  it("returns 400 for an invalid artifactId in the POST body", async () => {
    const response = await POST(createPostRequest({ artifactId: "bad-id" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "artifactId is required in request body",
    });
  });

  it.each(["id_doc", "selfie"])(
    "streams %s evidence for an authorized admin when the active-case lookup is stale",
    async (stepType) => {
      mockAdminClientForArtifact(
        makeArtifact({ r2_key: `kyc/${stepType}/user-1/file.bin`, step_type: stepType }),
        { activeStepCount: 0 }
      );
      mockDownloadResult(JPEG_BYTES);

      const response = await GET(createGetRequest(EVIDENCE_URL));

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      expect(response.headers.get("Content-Disposition")).toBe("inline");
      expect(Buffer.from(await response.arrayBuffer()).equals(JPEG_BYTES)).toBe(true);
      expect(mockDownloadKycDocument).toHaveBeenCalledWith(`kyc/${stepType}/user-1/file.bin`);
    }
  );

  it("streams evidence for an authorized admin when session linkage is stale", async () => {
    mockGetLinkedEvidenceArtifactIds.mockResolvedValue(["artifact-99"]);
    mockAdminClientForArtifact(makeArtifact());
    mockDownloadResult(JPEG_BYTES);

    const response = await GET(createGetRequest(EVIDENCE_URL));

    expect(response.status).toBe(200);
    expect(mockDownloadKycDocument).toHaveBeenCalledWith("kyc/id_document/user-1/file.bin");
  });

  it("returns missing_file without substituting another same-step artifact when the requested file is missing", async () => {
    const { artifactLookupCount } = mockAdminClientForArtifact(
      makeArtifact({ r2_key: "kyc/id_document/user-1/missing.bin" })
    );
    // If the route tried any other object it would get a servable image.
    mockDownloadKycDocument
      .mockRejectedValueOnce(new Error("NoSuchKey: missing"))
      .mockResolvedValue({ buffer: JPEG_BYTES, downloadMs: 10, decryptMs: 15 });

    const response = await GET(createGetRequest(EVIDENCE_URL));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "missing_file" });
    expect(mockDownloadKycDocument).toHaveBeenCalledTimes(1);
    expect(mockDownloadKycDocument).toHaveBeenCalledWith("kyc/id_document/user-1/missing.bin");
    expect(artifactLookupCount()).toBe(1);
  });

  it("returns missing_file after exactly one download attempt for a purged object", async () => {
    mockAdminClientForArtifact(makeArtifact({ r2_key: "kyc/id_document/user-1/purged.bin" }));
    mockDownloadKycDocument.mockRejectedValue(new Error("The specified key does not exist."));

    const response = await GET(createGetRequest(EVIDENCE_URL));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "missing_file" });
    expect(mockDownloadKycDocument).toHaveBeenCalledTimes(1);
  });

  it("returns server_error for a non-missing download failure without fallback", async () => {
    mockAdminClientForArtifact(makeArtifact({ r2_key: "kyc/id_document/user-1/bad.bin" }));
    mockDownloadKycDocument.mockRejectedValueOnce(new Error("decrypt failed"));

    const response = await GET(createGetRequest(EVIDENCE_URL));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: "server_error" });
    expect(mockDownloadKycDocument).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["JPEG", JPEG_BYTES, "image/jpeg"],
    ["PNG", PNG_BYTES, "image/png"],
    ["WebP", WEBP_BYTES, "image/webp"],
    ["PDF", PDF_BYTES, "application/pdf"],
  ])(
    "serves %s evidence inline with the Content-Type sniffed from its magic bytes",
    async (_label, bytes, expectedType) => {
      // The stored label deliberately disagrees; only the bytes decide the type.
      mockAdminClientForArtifact(makeArtifact({ content_type: "text/html" }));
      mockDownloadResult(bytes);

      const response = await GET(createGetRequest(EVIDENCE_URL));

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(expectedType);
      expect(response.headers.get("Content-Disposition")).toBe("inline");
      expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
    }
  );

  it("downloads unrecognised bytes as an octet-stream attachment even when labelled as an image", async () => {
    mockAdminClientForArtifact(makeArtifact({ content_type: "image/jpeg" }));
    mockDownloadResult(HTML_BYTES);

    const response = await GET(createGetRequest(EVIDENCE_URL));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Content-Disposition")).toBe("attachment");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sends a sandboxed CSP and hardening headers with evidence", async () => {
    mockAdminClientForArtifact(makeArtifact());
    mockDownloadResult(PNG_BYTES);

    const response = await GET(createGetRequest(EVIDENCE_URL));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toBe(EVIDENCE_CSP);
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
  });

  it("hashes cf-connecting-ip in preference to a client-supplied x-forwarded-for", async () => {
    vi.stubEnv("IP_HASH_SECRET", "test-ip-hash-secret");
    const accessLogInsert = vi.fn().mockResolvedValue({ error: null });
    mockAdminClientForArtifact(makeArtifact(), { accessLogInsert });
    mockDownloadResult(JPEG_BYTES);

    const response = await GET(
      createGetRequest(EVIDENCE_URL, {
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "198.51.100.23, 10.0.0.1",
        "x-real-ip": "10.0.0.2",
      })
    );

    const expectedHash = crypto
      .createHmac("sha256", "test-ip-hash-secret")
      .update("203.0.113.7")
      .digest("hex")
      .slice(0, 16);
    const spoofedHash = crypto
      .createHmac("sha256", "test-ip-hash-secret")
      .update("198.51.100.23")
      .digest("hex")
      .slice(0, 16);

    expect(response.status).toBe(200);
    expect(accessLogInsert).toHaveBeenCalledWith(
      expect.objectContaining({ artifact_id: "artifact-1", ip_hash: expectedHash })
    );
    expect(accessLogInsert.mock.calls[0][0].ip_hash).not.toBe(spoofedHash);
  });

  it("falls back to the first x-forwarded-for address when cf-connecting-ip is absent", async () => {
    vi.stubEnv("IP_HASH_SECRET", "test-ip-hash-secret");
    const accessLogInsert = vi.fn().mockResolvedValue({ error: null });
    mockAdminClientForArtifact(makeArtifact(), { accessLogInsert });
    mockDownloadResult(JPEG_BYTES);

    await GET(
      createGetRequest(EVIDENCE_URL, {
        "x-forwarded-for": "198.51.100.23, 10.0.0.1",
      })
    );

    const expectedHash = crypto
      .createHmac("sha256", "test-ip-hash-secret")
      .update("198.51.100.23")
      .digest("hex")
      .slice(0, 16);
    expect(accessLogInsert).toHaveBeenCalledWith(
      expect.objectContaining({ ip_hash: expectedHash })
    );
  });
});

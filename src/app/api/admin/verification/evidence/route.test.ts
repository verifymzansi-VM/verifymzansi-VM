import { beforeEach, describe, expect, it, vi } from "vitest";
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

function createGetRequest(url: string): NextRequest {
  return {
    nextUrl: new URL(url),
    url,
    headers: {
      get: vi.fn().mockReturnValue(null),
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

function createAccessLogsBuilder() {
  return {
    insert: vi.fn().mockResolvedValue({ error: null }),
  };
}

describe("/api/admin/verification/evidence", () => {
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
    mockGetLinkedEvidenceArtifactIds.mockResolvedValue(["artifact-1", "artifact-2"]);
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

  it("streams evidence for an authorized admin when the active-case lookup is stale", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "artifact-1",
                user_id: "user-1",
                r2_key: "kyc/id_document/user-1/file.bin",
                content_type: "image/jpeg",
                artifact_kind: "document",
                step_type: "id_doc",
              },
              error: null,
            }),
          };
        }

        if (table === "verification_steps") {
          return createVerificationStepsBuilder(0);
        }

        if (table === "kyc_evidence_access_logs") {
          return createAccessLogsBuilder();
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      }),
    });

    mockDownloadKycDocument.mockResolvedValue({
      buffer: Buffer.from("document-image"),
      downloadMs: 4,
      decryptMs: 6,
    });

    const response = await GET(
      createGetRequest(
        "http://localhost:3000/api/admin/verification/evidence?artifactId=123e4567-e89b-42d3-a456-426614174000"
      )
    );

    expect(response.status).toBe(200);
    expect(mockDownloadKycDocument).toHaveBeenCalledWith("kyc/id_document/user-1/file.bin");
  });

  it("streams evidence for an authorized admin when session linkage is stale", async () => {
    mockGetLinkedEvidenceArtifactIds.mockResolvedValue(["artifact-99"]);

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "artifact-1",
                user_id: "user-1",
                r2_key: "kyc/id_document/user-1/file.bin",
                content_type: "image/jpeg",
                artifact_kind: "document",
                step_type: "id_doc",
              },
              error: null,
            }),
          };
        }

        if (table === "verification_steps") {
          return createVerificationStepsBuilder(1);
        }

        if (table === "kyc_evidence_access_logs") {
          return createAccessLogsBuilder();
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      }),
    });

    mockDownloadKycDocument.mockResolvedValue({
      buffer: Buffer.from("document-image"),
      downloadMs: 4,
      decryptMs: 6,
    });

    const response = await GET(
      createGetRequest(
        "http://localhost:3000/api/admin/verification/evidence?artifactId=123e4567-e89b-42d3-a456-426614174000"
      )
    );

    expect(response.status).toBe(200);
    expect(mockDownloadKycDocument).toHaveBeenCalledWith("kyc/id_document/user-1/file.bin");
  });

  it("falls back to a newer authorized artifact for the same step when the requested file is missing", async () => {
    let artifactQueryCount = 0;
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "kyc_artifacts") {
          artifactQueryCount += 1;
          if (artifactQueryCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "artifact-1",
                  user_id: "user-1",
                  r2_key: "kyc/id_document/user-1/missing.bin",
                  content_type: "image/jpeg",
                  artifact_kind: "document",
                  step_type: "id_doc",
                },
                error: null,
              }),
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
                    r2_key: "kyc/id_document/user-1/fallback.bin",
                    created_at: "2026-03-27T09:30:00Z",
                  },
                  {
                    id: "artifact-1",
                    r2_key: "kyc/id_document/user-1/missing.bin",
                    created_at: "2026-03-27T08:30:00Z",
                  },
                ],
                error: null,
              }),
            }),
          };
        }

        if (table === "verification_steps") {
          return createVerificationStepsBuilder();
        }

        if (table === "kyc_evidence_access_logs") {
          return createAccessLogsBuilder();
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      }),
    });

    mockDownloadKycDocument
      .mockRejectedValueOnce(new Error("NoSuchKey: missing"))
      .mockResolvedValueOnce({
        buffer: Buffer.from("fallback-image"),
        downloadMs: 10,
        decryptMs: 15,
      });

    const response = await GET(
      createGetRequest(
        "http://localhost:3000/api/admin/verification/evidence?artifactId=123e4567-e89b-42d3-a456-426614174000"
      )
    );

    expect(response.status).toBe(200);
    expect(mockDownloadKycDocument).toHaveBeenNthCalledWith(
      1,
      "kyc/id_document/user-1/missing.bin"
    );
    expect(mockDownloadKycDocument).toHaveBeenNthCalledWith(
      2,
      "kyc/id_document/user-1/fallback.bin"
    );
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("returns missing_file when all same-step candidates are missing", async () => {
    let artifactQueryCount = 0;
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "kyc_artifacts") {
          artifactQueryCount += 1;
          if (artifactQueryCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "artifact-1",
                  user_id: "user-1",
                  r2_key: "kyc/id_document/user-1/missing.bin",
                  content_type: "image/jpeg",
                  artifact_kind: "document",
                  step_type: "id_doc",
                },
                error: null,
              }),
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
                    r2_key: "kyc/id_document/user-1/also-missing.bin",
                    created_at: "2026-03-27T09:30:00Z",
                  },
                ],
                error: null,
              }),
            }),
          };
        }

        if (table === "verification_steps") {
          return createVerificationStepsBuilder();
        }

        if (table === "kyc_evidence_access_logs") {
          return createAccessLogsBuilder();
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      }),
    });

    mockDownloadKycDocument
      .mockRejectedValueOnce(new Error("NoSuchKey: missing"))
      .mockRejectedValueOnce(new Error("NoSuchKey: also missing"));

    const response = await GET(
      createGetRequest(
        "http://localhost:3000/api/admin/verification/evidence?artifactId=123e4567-e89b-42d3-a456-426614174000"
      )
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "missing_file" });
  });

  it("returns server_error for a non-missing download failure without fallback", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "kyc_artifacts") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "artifact-1",
                user_id: "user-1",
                r2_key: "kyc/id_document/user-1/bad.bin",
                content_type: "image/jpeg",
                artifact_kind: "document",
                step_type: "id_doc",
              },
              error: null,
            }),
          };
        }

        if (table === "verification_steps") {
          return createVerificationStepsBuilder();
        }

        if (table === "kyc_evidence_access_logs") {
          return createAccessLogsBuilder();
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      }),
    });

    mockDownloadKycDocument.mockRejectedValueOnce(new Error("decrypt failed"));

    const response = await GET(
      createGetRequest(
        "http://localhost:3000/api/admin/verification/evidence?artifactId=123e4567-e89b-42d3-a456-426614174000"
      )
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: "server_error" });
    expect(mockDownloadKycDocument).toHaveBeenCalledTimes(1);
  });
});

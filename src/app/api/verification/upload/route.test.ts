import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

// ── Hoisted mocks ────────────────────────────────────────────

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFrom,
  mockUploadKycDocument,
  mockDeleteFromR2,
  mockLogAuditEvent,
  mockProcessKycArtifact,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
  mockUploadKycDocument: vi.fn(),
  mockDeleteFromR2: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockProcessKycArtifact: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/services/storage", () => ({
  uploadKycDocument: mockUploadKycDocument,
  deleteFromR2: mockDeleteFromR2,
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("@/lib/services/kyc-engine", () => ({
  processKycArtifact: mockProcessKycArtifact,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { POST } from "./route";

// ── Helpers ──────────────────────────────────────────────────

function createFormDataRequest(fields: Record<string, string | Blob>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  // NextRequest.formData() can hang in jsdom, so we mock it directly
  const req = {
    formData: async () => formData,
    nextUrl: new URL("http://localhost/api/verification/upload"),
    headers: {
      get: vi.fn((name: string) =>
        name.toLowerCase() === "origin" ? "http://localhost:3000" : null
      ),
    },
  } as unknown as NextRequest;
  return req;
}

function createTestFile(content = "fake-image-content", type = "image/jpeg", name = "test.jpg") {
  return new File([content], name, { type });
}

function mockAuth(
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null
) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: "Not authenticated" },
      }),
    },
  });
}

function setupDefaultAdminMocks() {
  mockFrom.mockImplementation((table: string) => {
    if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
          }),
        }),
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          if (payload.account_verification_status || payload.seller_verification_status) {
            return {
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  select: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            };
          }

          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          };
        }),
      };
    }
    if (table === "kyc_artifacts") {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: "artifact-1" }, error: null }),
          }),
        }),
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          if (payload.status === "rejected") {
            return {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  neq: vi.fn().mockReturnValue({
                    in: vi.fn().mockResolvedValue({ error: null }),
                  }),
                }),
              }),
            };
          }

          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          };
        }),
      };
    }
    if (table === "verification_steps") {
      return {
        upsert: vi.fn().mockResolvedValue({ error: null }),
      };
    }
    if (table === "verification_sessions") {
      return {
        upsert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    }
    return {};
  });

  mockUploadKycDocument.mockResolvedValue({
    url: "https://r2.example.com/key",
    key: "kyc/id_doc/profile-1/file.bin",
  });

  mockProcessKycArtifact.mockResolvedValue({
    sha256: "abc123",
    riskScore: 0,
    riskLevel: "low",
    providerRef: "sim_rev_123",
    autoStatus: "needs_manual_review",
    idNumberHmac: undefined,
  });

  mockLogAuditEvent.mockResolvedValue(undefined);
}

// ── Tests ────────────────────────────────────────────────────

describe("POST /api/verification/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ from: mockFrom });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(
      "ID_ENCRYPTION_KEY",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" // secret-scan: allow
    );
  });

  it("returns 401 when user is not authenticated", async () => {
    mockAuth(null);
    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "id_document",
    });

    const response = await POST(req);
    expect(response.status).toBe(401);
  });

  it("returns 400 when file is missing", async () => {
    mockAuth({ id: "user-1" });
    const req = createFormDataRequest({
      docType: "id_document",
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("File is required");
  });

  it("returns 400 when docType is invalid", async () => {
    mockAuth({ id: "user-1" });
    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "invalid_type",
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("returns success for valid id_document upload", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });
    setupDefaultAdminMocks();

    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "id_document",
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.artifactId).toBe("artifact-1");
    expect(data.stepType).toBe("id_doc");
  });

  it("returns success for valid selfie upload", async () => {
    mockAuth({ id: "user-1" });
    setupDefaultAdminMocks();

    const req = createFormDataRequest({
      file: createTestFile("selfie-data", "image/png", "selfie.png"),
      docType: "selfie",
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.stepType).toBe("selfie");
  });

  it("calls processKycArtifact with correct params", async () => {
    mockAuth({ id: "user-1" });
    setupDefaultAdminMocks();

    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "id_document",
    });

    await POST(req);

    expect(mockProcessKycArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "artifact-1",
        userId: "user-1",
        stepType: "id_doc",
      })
    );
  });

  it("logs audit event on successful upload", async () => {
    mockAuth({ id: "user-1" });
    setupDefaultAdminMocks();

    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "id_document",
    });

    await POST(req);

    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "verification_submitted",
        actorId: "user-1",
        targetType: "kyc_artifact",
      })
    );
  });

  it("auto-creates account profile when none exists", async () => {
    mockAuth({ id: "user-1", email: "member@example.com" });

    const upsertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "new-profile" }, error: null }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          upsert: upsertMock,
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            if (payload.account_verification_status || payload.seller_verification_status) {
              return {
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    select: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              };
            }

            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }),
        };
      }
      if (table === "kyc_artifacts") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: "artifact-1" }, error: null }),
            }),
          }),
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            if (payload.status === "rejected") {
              return {
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    neq: vi.fn().mockReturnValue({
                      in: vi.fn().mockResolvedValue({ error: null }),
                    }),
                  }),
                }),
              };
            }

            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }),
        };
      }
      if (table === "verification_steps") {
        return { upsert: vi.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "verification_sessions") {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {};
    });

    mockUploadKycDocument.mockResolvedValue({ url: "u", key: "k" });
    mockProcessKycArtifact.mockResolvedValue({
      sha256: "abc",
      riskScore: 0,
      riskLevel: "low",
      providerRef: "ref",
      autoStatus: "needs_manual_review",
    });
    mockLogAuditEvent.mockResolvedValue(undefined);

    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "id_document",
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(upsertMock).toHaveBeenCalled();
  });

  it("rolls back orphaned R2 file when artifact insert fails", async () => {
    mockAuth({ id: "user-1" });

    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "kyc_artifacts") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "Insert failed" },
              }),
            }),
          }),
        };
      }
      return {};
    });

    mockUploadKycDocument.mockResolvedValue({ url: "u", key: "real-key" });
    mockDeleteFromR2.mockResolvedValue(undefined);

    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "id_document",
    });

    const response = await POST(req);
    expect(response.status).toBe(500);
    expect(mockDeleteFromR2).toHaveBeenCalled();
  });

  it("promotes account status to pending_review and links the artifact into the session", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });

    const sessionUpsert = vi.fn().mockResolvedValue({ error: null });
    const accountStatusSelect = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "profile-1" }], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
            }),
          }),
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            if (payload.account_verification_status || payload.seller_verification_status) {
              return {
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    select: accountStatusSelect,
                  }),
                }),
              };
            }

            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }),
        };
      }
      if (table === "kyc_artifacts") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: "artifact-1" }, error: null }),
            }),
          }),
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            if (payload.status === "rejected") {
              return {
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    neq: vi.fn().mockReturnValue({
                      in: vi.fn().mockResolvedValue({ error: null }),
                    }),
                  }),
                }),
              };
            }

            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }),
        };
      }
      if (table === "verification_steps") {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === "verification_sessions") {
        return {
          upsert: sessionUpsert,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id_artifact_id: "artifact-1",
                  selfie_artifact_id: null,
                  location_submitted_at: null,
                  finalized_at: null,
                },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }
      return {};
    });

    mockUploadKycDocument.mockResolvedValue({ url: "u", key: "k" });
    mockProcessKycArtifact.mockResolvedValue({
      sha256: "abc",
      riskScore: 0,
      riskLevel: "low",
      providerRef: "ref",
      autoStatus: "needs_manual_review",
    });
    mockLogAuditEvent.mockResolvedValue(undefined);

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
      })
    );

    expect(response.status).toBe(200);
    expect(sessionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        id_artifact_id: "artifact-1",
      }),
      { onConflict: "user_id" }
    );
    expect(accountStatusSelect).toHaveBeenCalled();
  });

  it("clears prior review metadata and reopens the verification session on resubmission", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });

    const stepUpsert = vi.fn().mockResolvedValue({ error: null });
    const sessionUpsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
            }),
          }),
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            if (payload.account_verification_status || payload.seller_verification_status) {
              return {
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    select: vi.fn().mockResolvedValue({ data: [{ id: "profile-1" }], error: null }),
                  }),
                }),
              };
            }

            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }),
        };
      }
      if (table === "kyc_artifacts") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: "artifact-1" }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return {
          upsert: stepUpsert,
        };
      }
      if (table === "verification_sessions") {
        return {
          upsert: sessionUpsert,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id_artifact_id: "artifact-1",
                  selfie_artifact_id: null,
                  location_submitted_at: null,
                  finalized_at: null,
                },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }
      return {};
    });

    mockUploadKycDocument.mockResolvedValue({ url: "u", key: "k" });
    mockProcessKycArtifact.mockResolvedValue({
      sha256: "abc",
      riskScore: 10,
      riskLevel: "medium",
      providerRef: "provider-ref",
      autoStatus: "needs_manual_review",
    });

    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "id_document",
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(stepUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        reviewed_by: null,
        reviewed_at: null,
        reason_code: null,
        reason_note: null,
        override_reason_code: null,
      }),
      { onConflict: "user_id,step_type" }
    );
    expect(sessionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        id_artifact_id: "artifact-1",
        finalized_at: null,
      }),
      { onConflict: "user_id" }
    );
  });
});

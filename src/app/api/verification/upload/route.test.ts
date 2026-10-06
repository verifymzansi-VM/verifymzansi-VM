import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import type { ScanResult } from "@/lib/utils/malware-scan";

const CSRF_TOKEN = "a".repeat(64);
/** Valid SA ID number (DOB 1980-01-01, correct Luhn check digit). */
const VALID_SA_ID_NUMBER = "8001015009087";

// ── Hoisted mocks ────────────────────────────────────────────

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFrom,
  mockUploadKycDocument,
  mockDeleteFromR2,
  mockHasR2WriteAccess,
  mockLogAuditEvent,
  mockProcessKycArtifact,
  mockCheckRateLimit,
  mockGetClientIp,
  mockValidateBufferIntegrity,
  mockScanForMalware,
  mockStripExifFromJpeg,
  mockStripMetadataFromPng,
  mockIsFeatureEnabled,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
  mockUploadKycDocument: vi.fn(),
  mockDeleteFromR2: vi.fn(),
  mockHasR2WriteAccess: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockProcessKycArtifact: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockValidateBufferIntegrity: vi.fn(() => ({
    valid: true,
    detectedMime: "image/jpeg",
    mismatch: false,
  })),
  mockScanForMalware: vi.fn<(buffer: Uint8Array, declaredMime: string) => ScanResult>(() => ({
    safe: true,
  })),
  mockStripExifFromJpeg: vi.fn((buf: Uint8Array) => buf),
  mockStripMetadataFromPng: vi.fn((buf: Uint8Array) => buf),
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
  hasR2WriteAccess: mockHasR2WriteAccess,
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

vi.mock("@/lib/utils/file-validation", () => ({
  validateBufferIntegrity: mockValidateBufferIntegrity,
}));

vi.mock("@/lib/utils/malware-scan", () => ({
  scanForMalware: mockScanForMalware,
}));

vi.mock("@/lib/utils/exif-strip", () => ({
  stripExifFromJpeg: mockStripExifFromJpeg,
  stripMetadataFromPng: mockStripMetadataFromPng,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

vi.mock("@/lib/services/feature-flags", () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

import { POST } from "./route";

// ── Helpers ──────────────────────────────────────────────────

function createFormDataRequest(
  fields: Record<string, string | Blob>,
  options: { omitIdNumber?: boolean } = {}
) {
  const formData = new FormData();
  const shouldAddLegalNames =
    fields.docType === "id_document" && !("firstName" in fields) && !("lastName" in fields);
  // id_document uploads require a 13-digit SA ID number; default to one with a
  // valid Luhn checksum (DOB 1980-01-01) unless the test supplies its own.
  const shouldAddIdNumber =
    fields.docType === "id_document" && !("idNumber" in fields) && !options.omitIdNumber;
  const finalFields = {
    ...fields,
    ...(shouldAddLegalNames ? { firstName: "Sipho", lastName: "Mokoena" } : {}),
    ...(shouldAddIdNumber ? { idNumber: VALID_SA_ID_NUMBER } : {}),
  };
  for (const [key, value] of Object.entries(finalFields)) {
    formData.append(key, value);
  }
  // NextRequest.formData() can hang in jsdom, so we mock it directly
  const req = {
    formData: async () => formData,
    url: "http://localhost/api/verification/upload",
    nextUrl: new URL("http://localhost/api/verification/upload"),
    headers: {
      get: vi.fn((name: string) => {
        const normalizedName = name.toLowerCase();
        if (normalizedName === "origin") return "http://localhost";
        if (normalizedName === "cookie") return `vm_csrf=${CSRF_TOKEN}`;
        if (normalizedName === "x-csrf-token") return CSRF_TOKEN;
        return null;
      }),
    },
  } as unknown as NextRequest;
  return req;
}

function createTestFile(content = "fake-image-content", type = "image/jpeg", name = "test.jpg") {
  return new File([content], name, { type });
}

function mockAuth(
  user: {
    id: string;
    email?: string;
    email_confirmed_at?: string | null;
    user_metadata?: Record<string, unknown>;
  } | null
) {
  const normalizedUser = user
    ? {
        email_confirmed_at: "2026-03-21T00:00:00.000Z",
        ...user,
      }
    : null;

  mockCreateClient.mockResolvedValue({
    from: mockFrom,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: normalizedUser },
        error: normalizedUser ? null : { message: "Not authenticated" },
      }),
    },
  });
}

function setupDefaultAdminMocks() {
  mockFrom.mockImplementation((table: string) => {
    if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
      const fluentChain = (): Record<string, ReturnType<typeof vi.fn>> => {
        const chain: Record<string, ReturnType<typeof vi.fn>> = {
          eq: vi.fn().mockImplementation(() => fluentChain()),
          neq: vi.fn().mockImplementation(() => fluentChain()),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { id: "profile-1", phone: "+27123456789" }, error: null }),
        };
        return chain;
      };
      return {
        select: vi.fn().mockImplementation(() => fluentChain()),
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          if (payload.account_verification_status || payload.account_verification_status) {
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
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              single: vi.fn().mockResolvedValue({ data: { risk_score: 0 }, error: null }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: { id: "step-1", risk_score: 0 }, error: null }),
                }),
              }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: { id: "step-1", risk_score: 0 }, error: null }),
          }),
        }),
      };
    }
    if (table === "verification_sessions") {
      return {
        upsert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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

/**
 * Default admin mocks, plus an existing pending step for the user and a stubbed
 * decision_records lookup (pending high-risk approvals awaiting a second reviewer).
 */
function mockExistingPendingStep(decisionLookup: {
  count: number | null;
  error: { message: string } | null;
}) {
  setupDefaultAdminMocks();
  const baseFromImpl = mockFrom.getMockImplementation();
  if (!baseFromImpl) {
    throw new Error("Expected default admin mock implementation");
  }

  const existingStep = {
    id: "step-existing-1",
    status: "pending",
    risk_score: 0,
    risk_level: "low",
    auto_status: "needs_manual_review",
  };
  const stepSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: existingStep, error: null }),
      }),
    }),
  });
  const decisionIn = vi.fn().mockResolvedValue(decisionLookup);
  const decisionCaseIdEq = vi.fn().mockReturnValue({ in: decisionIn });
  const decisionCaseTypeEq = vi.fn().mockReturnValue({ eq: decisionCaseIdEq });
  const decisionSelect = vi.fn().mockReturnValue({ eq: decisionCaseTypeEq });

  mockFrom.mockImplementation((table: string) => {
    if (table === "verification_steps") {
      return { ...baseFromImpl(table), select: stepSelect };
    }
    if (table === "decision_records") {
      return { select: decisionSelect };
    }
    return baseFromImpl(table);
  });

  return {
    existingStep,
    stepSelect,
    decisionSelect,
    decisionCaseTypeEq,
    decisionCaseIdEq,
    decisionIn,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("POST /api/verification/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ from: mockFrom });
    mockHasR2WriteAccess.mockResolvedValue(true);
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockValidateBufferIntegrity.mockReturnValue({
      valid: true,
      detectedMime: "image/jpeg",
      mismatch: false,
    });
    mockScanForMalware.mockReturnValue({ safe: true });
    mockStripExifFromJpeg.mockImplementation((buf: Uint8Array) => buf);
    mockStripMetadataFromPng.mockImplementation((buf: Uint8Array) => buf);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KYC_ENCRYPTION_KEY", "ab".repeat(32));
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

  it("returns a coded email-confirmation blocker when the account email is unconfirmed", async () => {
    mockAuth({ id: "user-1", email_confirmed_at: null });

    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "id_document",
    });

    const response = await POST(req);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: expect.stringContaining("confirm your email"),
        code: "email_confirmation_required",
      })
    );
  });

  it("returns 503 when shared upload protection is unavailable", async () => {
    mockAuth({ id: "user-1" });
    mockCheckRateLimit.mockResolvedValue({ limited: true, degraded: true, retryAfter: 45 });

    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "id_document",
    });

    const response = await POST(req);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("45");
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        requestId: expect.any(String),
      })
    );
  });

  it("returns storage_unavailable in production when no writable KYC storage is configured", async () => {
    mockAuth({ id: "user-1" });
    mockHasR2WriteAccess.mockResolvedValue(false);
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
        idNumber: "9001015009087",
      })
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("X-Request-Id")).toEqual(expect.any(String));
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        code: "storage_unavailable",
        requestId: expect.any(String),
      })
    );
    expect(mockUploadKycDocument).not.toHaveBeenCalled();
  });

  it.each(["id_document", "selfie"])(
    "allows %s uploads in production when native KYC storage is available",
    async (docType) => {
      mockAuth({ id: "user-1", email: "test@example.com" });
      setupDefaultAdminMocks();
      mockHasR2WriteAccess.mockResolvedValue(true);
      vi.stubEnv("NODE_ENV", "production");

      const file =
        docType === "selfie"
          ? createTestFile("selfie-data", "image/png", "selfie.png")
          : createTestFile();

      const response = await POST(
        createFormDataRequest({
          file,
          docType,
        })
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          success: true,
          stepType: docType === "selfie" ? "selfie" : "id_doc",
        })
      );
    }
  );

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

  it("rejects uploads when the declared MIME type does not match the file bytes", async () => {
    mockAuth({ id: "user-1" });
    setupDefaultAdminMocks();
    mockValidateBufferIntegrity.mockReturnValue({
      valid: false,
      detectedMime: "application/pdf",
      mismatch: true,
    });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: expect.stringContaining("File type does not match its content"),
      })
    );
    expect(mockUploadKycDocument).not.toHaveBeenCalled();
  });

  it("rejects uploads flagged by malware scanning", async () => {
    mockAuth({ id: "user-1" });
    setupDefaultAdminMocks();
    mockScanForMalware.mockReturnValue({ safe: false, threat: "eicar" });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: expect.stringContaining("suspicious content"),
      })
    );
    expect(mockUploadKycDocument).not.toHaveBeenCalled();
  });

  it("strips JPEG metadata before upload", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });
    setupDefaultAdminMocks();
    mockValidateBufferIntegrity.mockReturnValue({
      valid: true,
      detectedMime: "image/jpeg",
      mismatch: false,
    });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
      })
    );

    expect(response.status).toBe(200);
    expect(mockStripExifFromJpeg).toHaveBeenCalledTimes(1);
    expect(mockStripMetadataFromPng).not.toHaveBeenCalled();
  });

  it("strips PNG metadata before upload", async () => {
    mockAuth({ id: "user-1" });
    setupDefaultAdminMocks();
    mockValidateBufferIntegrity.mockReturnValue({
      valid: true,
      detectedMime: "image/png",
      mismatch: false,
    });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile("selfie-data", "image/png", "selfie.png"),
        docType: "selfie",
      })
    );

    expect(response.status).toBe(200);
    expect(mockStripMetadataFromPng).toHaveBeenCalledTimes(1);
    expect(mockStripExifFromJpeg).not.toHaveBeenCalled();
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
        single: vi
          .fn()
          .mockResolvedValue({ data: { id: "new-profile", phone: "+27123456789" }, error: null }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        const profileChain = (): Record<string, ReturnType<typeof vi.fn>> => ({
          eq: vi.fn().mockImplementation(() => profileChain()),
          neq: vi.fn().mockImplementation(() => profileChain()),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        });
        return {
          select: vi.fn().mockImplementation(() => profileChain()),
          upsert: upsertMock,
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            if (payload.account_verification_status || payload.account_verification_status) {
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
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                single: vi.fn().mockResolvedValue({ data: { risk_score: 0 }, error: null }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle: vi
                      .fn()
                      .mockResolvedValue({ data: { id: "step-1", risk_score: 0 }, error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: "step-1", risk_score: 0 }, error: null }),
            }),
          }),
        };
      }
      if (table === "verification_sessions") {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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
        const profileChain = (): Record<string, ReturnType<typeof vi.fn>> => ({
          eq: vi.fn().mockImplementation(() => profileChain()),
          neq: vi.fn().mockImplementation(() => profileChain()),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "profile-1", phone: "+27123456789" },
            error: null,
          }),
        });
        return {
          select: vi.fn().mockImplementation(() => profileChain()),
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
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                single: vi.fn().mockResolvedValue({ data: { risk_score: 0 }, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    mockUploadKycDocument.mockResolvedValue({ url: "u", key: "real-key" });
    mockDeleteFromR2
      .mockRejectedValueOnce(new Error("temporary failure 1"))
      .mockRejectedValueOnce(new Error("temporary failure 2"))
      .mockResolvedValue(undefined);

    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "id_document",
    });

    const response = await POST(req);
    expect(response.status).toBe(500);
    expect(mockDeleteFromR2).toHaveBeenCalledTimes(3);
  });

  it("rejects numeric legal names for id document uploads", async () => {
    mockAuth({ id: "user-1" });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
        firstName: "12345",
        lastName: "Mokoena",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: "Invalid upload metadata",
      })
    );
    expect(mockUploadKycDocument).not.toHaveBeenCalled();
  });

  it("keeps account incomplete until all required verification steps are submitted", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });

    const sessionUpsert = vi.fn().mockResolvedValue({ error: null });
    const accountStatusSelect = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "profile-1" }], error: null });
    const stepUpdatePayloads: Array<Record<string, unknown>> = [];
    const statusUpdatePayloads: Array<Record<string, unknown>> = [];

    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        const profileChain = (): Record<string, ReturnType<typeof vi.fn>> => ({
          eq: vi.fn().mockImplementation(() => profileChain()),
          neq: vi.fn().mockImplementation(() => profileChain()),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "profile-1", phone: "+27123456789" },
            error: null,
          }),
        });
        return {
          select: vi.fn().mockImplementation(() => profileChain()),
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            if (payload.account_verification_status || payload.account_verification_status) {
              statusUpdatePayloads.push(payload);
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
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                single: vi.fn().mockResolvedValue({ data: { risk_score: 0 }, error: null }),
              }),
            }),
          }),
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            stepUpdatePayloads.push(payload);
            return {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  neq: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({
                      maybeSingle: vi
                        .fn()
                        .mockResolvedValue({ data: { id: "step-1", risk_score: 0 }, error: null }),
                    }),
                  }),
                }),
              }),
            };
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: "step-1", risk_score: 0 }, error: null }),
            }),
          }),
        };
      }
      if (table === "verification_sessions") {
        return {
          upsert: sessionUpsert,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
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
      autoStatus: "approved",
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
    expect(statusUpdatePayloads).toEqual([
      expect.objectContaining({
        account_verification_status: "incomplete",
      }),
    ]);
    expect(stepUpdatePayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "pending",
          auto_status: "approved",
          reviewed_at: null,
        }),
      ])
    );
  });

  it("clears prior review metadata and reopens the verification session on resubmission", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });

    const stepUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { id: "step-1", risk_score: 0 }, error: null }),
            }),
          }),
        }),
      }),
    });
    const sessionUpsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        const profileChain = (): Record<string, ReturnType<typeof vi.fn>> => ({
          eq: vi.fn().mockImplementation(() => profileChain()),
          neq: vi.fn().mockImplementation(() => profileChain()),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "profile-1", phone: "+27123456789" },
            error: null,
          }),
        });
        return {
          select: vi.fn().mockImplementation(() => profileChain()),
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            if (payload.account_verification_status || payload.account_verification_status) {
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
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                single: vi.fn().mockResolvedValue({ data: { risk_score: 0 }, error: null }),
              }),
            }),
          }),
          update: stepUpdate,
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: "step-1", risk_score: 0 }, error: null }),
            }),
          }),
        };
      }
      if (table === "verification_sessions") {
        return {
          upsert: sessionUpsert,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
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
    expect(stepUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        reviewed_by: null,
        reviewed_at: null,
        reason_code: null,
        reason_note: null,
        override_reason_code: null,
      })
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

  it("returns 409 when an approved ID uniqueness conflict is raised during step save", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });
    setupDefaultAdminMocks();

    const baseFromImpl = mockFrom.getMockImplementation();
    if (!baseFromImpl) {
      throw new Error("Expected default admin mock implementation");
    }

    const artifactDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const artifactDelete = vi.fn().mockReturnValue({ eq: artifactDeleteEq });

    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_artifacts") {
        return {
          ...baseFromImpl(table),
          delete: artifactDelete,
        };
      }

      if (table === "verification_steps") {
        return {
          select: vi.fn().mockImplementation((...args: unknown[]) => {
            if (args[0] === "user_id") {
              // The pre-save uniqueness lookup finds no approved holder; the
              // conflict is only raised by the unique index during step save.
              return {
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    neq: vi.fn().mockReturnValue({
                      eq: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                        }),
                      }),
                    }),
                  }),
                }),
              };
            }

            return {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  single: vi.fn().mockResolvedValue({ data: { risk_score: 0 }, error: null }),
                }),
              }),
            };
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                      error: {
                        code: "23505",
                        message:
                          "duplicate key value violates unique constraint idx_verification_steps_unique_approved_id_hmac",
                      },
                    }),
                  }),
                }),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: "step-1", risk_score: 0 }, error: null }),
            }),
          }),
        };
      }

      return baseFromImpl(table);
    });

    mockProcessKycArtifact.mockResolvedValue({
      sha256: "abc123",
      riskScore: 0,
      riskLevel: "low",
      providerRef: "sim_ref_1",
      autoStatus: "needs_manual_review",
      idNumberHmac: "dup-hmac-1",
    });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: "This ID number is already linked to another account.",
        code: "id_number_duplicate",
      })
    );
    expect(mockDeleteFromR2).toHaveBeenCalled();
    expect(artifactDelete).toHaveBeenCalled();
    expect(artifactDeleteEq).toHaveBeenCalledWith("id", "artifact-1");
  });

  it("returns 500 when ID uniqueness lookup fails", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });
    setupDefaultAdminMocks();

    const baseFromImpl = mockFrom.getMockImplementation();
    if (!baseFromImpl) {
      throw new Error("Expected default admin mock implementation");
    }

    const artifactDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const artifactDelete = vi.fn().mockReturnValue({ eq: artifactDeleteEq });

    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_artifacts") {
        return {
          ...baseFromImpl(table),
          delete: artifactDelete,
        };
      }

      if (table === "verification_steps") {
        return {
          select: vi.fn().mockImplementation((...args: unknown[]) => {
            if (args[0] === "user_id") {
              return {
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    neq: vi.fn().mockReturnValue({
                      eq: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                          maybeSingle: vi.fn().mockResolvedValue({
                            data: null,
                            error: { message: "db query failed" },
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              };
            }

            return {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  single: vi.fn().mockResolvedValue({ data: { risk_score: 0 }, error: null }),
                }),
              }),
            };
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle: vi
                      .fn()
                      .mockResolvedValue({ data: { id: "step-1", risk_score: 0 }, error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: "step-1", risk_score: 0 }, error: null }),
            }),
          }),
        };
      }

      return baseFromImpl(table);
    });

    mockProcessKycArtifact.mockResolvedValue({
      sha256: "abc123",
      riskScore: 0,
      riskLevel: "low",
      providerRef: "sim_ref_1",
      autoStatus: "needs_manual_review",
      idNumberHmac: "dup-hmac-2",
    });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
        idNumber: "8001015009087",
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: "Unable to verify ID number uniqueness",
      })
    );
    expect(artifactDelete).toHaveBeenCalled();
    expect(artifactDeleteEq).toHaveBeenCalledWith("id", "artifact-1");
    expect(mockDeleteFromR2).toHaveBeenCalled();
  });

  it("returns 500 when risk signal insert fails for phone linked to flagged account", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });
    setupDefaultAdminMocks();

    const baseFromImpl = mockFrom.getMockImplementation();
    if (!baseFromImpl) {
      throw new Error("Expected default admin mock implementation");
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        const baseResult = baseFromImpl(table);
        return {
          ...baseResult,
          select: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockImplementation(() => ({
              neq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ id: "flagged-profile-1" }],
                    error: null,
                  }),
                }),
              }),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "profile-1", phone: "+27123456789" },
                error: null,
              }),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        };
      }

      if (table === "kyc_risk_signals") {
        return {
          insert: vi.fn().mockResolvedValue({
            error: { message: "risk_signals insert failed" },
          }),
        };
      }

      return baseFromImpl(table);
    });

    const req = createFormDataRequest({
      file: createTestFile(),
      docType: "id_document",
    });

    const response = await POST(req);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: "Upload processing failed",
      })
    );
  });

  it("rejects a too-short SA ID number at metadata validation before any storage writes", async () => {
    mockAuth({ id: "user-1" });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
        idNumber: "1234567",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: "Invalid upload metadata",
      })
    );
    expect(mockUploadKycDocument).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["omitted", { omitIdNumber: true }, {}],
    ["empty", {}, { idNumber: "" }],
  ] as const)(
    "rejects id_document uploads when the SA ID number is %s",
    async (_label, options, extraFields) => {
      mockAuth({ id: "user-1" });

      const response = await POST(
        createFormDataRequest(
          {
            file: createTestFile(),
            docType: "id_document",
            ...extraFields,
          },
          options
        )
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ error: "Invalid upload metadata" })
      );
      expect(mockUploadKycDocument).not.toHaveBeenCalled();
      expect(mockProcessKycArtifact).not.toHaveBeenCalled();
    }
  );

  it("returns 409 step_in_final_review when an approval for the existing step awaits a second reviewer", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });
    const {
      existingStep,
      stepSelect,
      decisionSelect,
      decisionCaseTypeEq,
      decisionCaseIdEq,
      decisionIn,
    } = mockExistingPendingStep({ count: 1, error: null });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ code: "step_in_final_review" })
    );
    expect(stepSelect).toHaveBeenCalledWith("id, status, risk_score, risk_level, auto_status");
    expect(decisionSelect).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(decisionCaseTypeEq).toHaveBeenCalledWith("case_type", "verification_step");
    expect(decisionCaseIdEq).toHaveBeenCalledWith("case_id", existingStep.id);
    expect(decisionIn).toHaveBeenCalledWith("status", ["pending_approval", "escalated"]);
    expect(mockUploadKycDocument).not.toHaveBeenCalled();
    expect(mockProcessKycArtifact).not.toHaveBeenCalled();
  });

  it("returns 500 when the pending-decision lookup for the existing step fails", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });
    const { decisionIn } = mockExistingPendingStep({
      count: null,
      error: { message: "decision_records unavailable" },
    });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ error: "Unable to verify step status. Please try again." })
    );
    expect(decisionIn).toHaveBeenCalled();
    expect(mockUploadKycDocument).not.toHaveBeenCalled();
  });

  it("allows re-uploading an existing pending step when no decision is awaiting review", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });
    const { decisionIn } = mockExistingPendingStep({ count: 0, error: null });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
      })
    );

    expect(response.status).toBe(200);
    expect(decisionIn).toHaveBeenCalled();
    expect(mockUploadKycDocument).toHaveBeenCalledTimes(1);
  });

  it("rejects an SA ID number that fails the Luhn checksum", async () => {
    mockAuth({ id: "user-1" });

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
        idNumber: "8001015009088", // valid format/DOB, wrong check digit
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: expect.stringContaining("Invalid SA ID number"),
      })
    );
    expect(mockUploadKycDocument).not.toHaveBeenCalled();
  });

  it("returns 503 in production when ID_ENCRYPTION_KEY is malformed", async () => {
    mockAuth({ id: "user-1" });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ID_ENCRYPTION_KEY", "not-a-hex-key");
    mockHasR2WriteAccess.mockResolvedValue(true);

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        code: "config_missing",
      })
    );
    expect(mockUploadKycDocument).not.toHaveBeenCalled();
  });

  it("rolls back the persisted artifact and R2 object when the risk engine throws", async () => {
    mockAuth({ id: "user-1", email: "test@example.com" });
    setupDefaultAdminMocks();

    const baseFromImpl = mockFrom.getMockImplementation();
    if (!baseFromImpl) {
      throw new Error("Expected default admin mock implementation");
    }

    const artifactDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const artifactDelete = vi.fn().mockReturnValue({ eq: artifactDeleteEq });

    const artifactUpdatePayloads: Record<string, unknown>[] = [];

    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_artifacts") {
        const base = baseFromImpl(table) as { update?: (p: Record<string, unknown>) => unknown };
        return {
          ...base,
          update: (payload: Record<string, unknown>) => {
            artifactUpdatePayloads.push(payload);
            return base.update?.(payload);
          },
          delete: artifactDelete,
        };
      }

      return baseFromImpl(table);
    });

    mockProcessKycArtifact.mockRejectedValue(
      new Error("HMAC_SECRET is not configured — cannot process KYC artifacts in production")
    );

    const response = await POST(
      createFormDataRequest({
        file: createTestFile(),
        docType: "id_document",
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error: "Upload processing failed",
        code: "engine_failed",
      })
    );
    // Artifact row and R2 object rolled back so a re-upload is not blocked
    // by idx_kyc_artifacts_pending_unique.
    expect(artifactDelete).toHaveBeenCalled();
    expect(artifactDeleteEq).toHaveBeenCalledWith("id", "artifact-1");
    expect(mockDeleteFromR2).toHaveBeenCalled();
    // Earlier evidence must not be superseded by an upload that failed.
    expect(artifactUpdatePayloads).not.toContainEqual({ status: "rejected" });
  });

  it("rejects retired proof-of-address uploads before storage or database changes", async () => {
    mockAuth({ id: "user-1" });
    const response = await POST(
      createFormDataRequest({
        file: createTestFile("poa-data", "image/jpeg", "poa.jpg"),
        docType: "proof_of_address",
      })
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "address_upload_retired" });
    expect(mockUploadKycDocument).not.toHaveBeenCalled();
    expect(mockProcessKycArtifact).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});

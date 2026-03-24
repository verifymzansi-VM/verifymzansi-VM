import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const CSRF_TOKEN = "a".repeat(64);

/**
 * Regression test: when verification_steps upsert fails after a successful
 * R2 upload + kyc_artifacts insert, the handler must clean up both the
 * artifact row and the R2 file to prevent orphaned encrypted data.
 */

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockUploadKycDocument,
  mockDeleteFromR2,
  mockLogAuditEvent,
  mockCheckRateLimit,
  mockProcessKycArtifact,
  mockEnforceSameOriginMutation,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockUploadKycDocument: vi.fn(),
  mockDeleteFromR2: vi.fn(),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  mockProcessKycArtifact: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/storage", () => ({
  uploadKycDocument: mockUploadKycDocument,
  deleteFromR2: mockDeleteFromR2,
}));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/services/kyc-engine", () => ({
  processKycArtifact: mockProcessKycArtifact,
}));
vi.mock("@/lib/utils/exif-strip", () => ({
  stripExifFromJpeg: (buf: Buffer) => buf,
}));
vi.mock("@/lib/utils/malware-scan", () => ({
  scanForMalware: () => ({ safe: true }),
}));
vi.mock("@/lib/utils/file-validation", () => ({
  validateBufferIntegrity: () => ({ valid: true, detectedMime: "image/jpeg" }),
}));
vi.mock("@/lib/validations/verification", () => ({
  fileUploadSchema: {
    safeParse: (input: Record<string, unknown>) => ({
      success: true,
      data: { docType: input.docType ?? "id_document", idNumber: input.idNumber ?? undefined },
    }),
  },
  validateUploadedFile: () => ({ valid: true }),
}));
vi.mock("@/lib/services/verification-state", () => ({
  buildPendingVerificationStep: (data: Record<string, unknown>) => data,
  buildVerificationSessionResumePatch: (userId: string, patch: Record<string, unknown>) => ({
    user_id: userId,
    ...patch,
  }),
}));
vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));
vi.mock("@/lib/utils/local-dev", () => ({
  isStrictLocalDevelopmentRequest: () => true,
}));
vi.mock("@/lib/services/feature-flags", () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/account/compat", () => ({
  ACCOUNT_PROFILE_TABLE: "account_profiles",
  ACCOUNT_PROFILE_WRITE_TABLE: "account_profiles",
}));
vi.mock("@/lib/account/ensure-profile", () => ({
  getDefaultDisplayName: () => "Test User",
}));

// Provide minimal env vars so the route doesn't short-circuit with 503
vi.stubEnv("KYC_ENCRYPTION_KEY", "a".repeat(64));
vi.stubEnv("R2_ACCOUNT_ID", "test");
vi.stubEnv("R2_ACCESS_KEY_ID", "test");
vi.stubEnv("R2_SECRET_ACCESS_KEY", "test");
vi.stubEnv("R2_PRIVATE_BUCKET", "test-bucket");

import { POST } from "@/app/api/verification/upload/route";

const USER_ID = "user-1";
const ARTIFACT_ID = "artifact-1";
const R2_KEY = "kyc/id_document/profile-1/123.enc";

function createUploadRequest(docType = "id_document"): NextRequest {
  const file = new File([new Uint8Array(1024)], "id-front.jpg", { type: "image/jpeg" });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("docType", docType);

  return {
    method: "POST",
    formData: async () => formData,
    headers: {
      get: vi.fn((name: string) => {
        if (name === "origin") return "http://localhost:3000";
        if (name === "x-forwarded-for") return "127.0.0.1";
        if (name === "cookie") return `vm_csrf=${CSRF_TOKEN}`;
        if (name === "x-csrf-token") return CSRF_TOKEN;
        return null;
      }),
    },
    ip: "127.0.0.1",
    url: "http://localhost:3000/api/verification/upload",
    nextUrl: new URL("http://localhost:3000/api/verification/upload"),
  } as unknown as NextRequest;
}

/**
 * Helper: builds a chainable Supabase-like query builder where every method
 * returns `this` by default, so any `.select().eq().eq().neq().in()...`
 * chain works without needing to mock every combination.
 */
function chainable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop in overrides) return overrides[prop];
      // Must NOT trap `then`/`catch`/`finally` — otherwise the proxy looks
      // like a thenable and `await proxy` hangs forever.
      if (prop === "then" || prop === "catch" || prop === "finally") return undefined;
      // Default: return a function that returns the proxy again (chainable)
      return (..._args: unknown[]) => proxy;
    },
  };
  const proxy = new Proxy(obj, handler);
  return proxy;
}

describe("POST /api/verification/upload — R2 cleanup on step failure", () => {
  let artifactDeleteSpy: ReturnType<typeof vi.fn>;
  let updateStepSpy: ReturnType<typeof vi.fn>;
  let insertStepSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: USER_ID,
              email: "test@example.com",
              email_confirmed_at: "2026-03-24T12:00:00.000Z",
            },
          },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return chainable({
            select: () =>
              chainable({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "profile-1", phone: "+27110000000" },
                    error: null,
                  }),
              }),
          });
        }

        return chainable({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        });
      }),
    });

    mockUploadKycDocument.mockResolvedValue({ url: `https://r2/${R2_KEY}`, key: R2_KEY });
    mockDeleteFromR2.mockResolvedValue(undefined);

    mockProcessKycArtifact.mockResolvedValue({
      sha256: "abc123",
      riskScore: 10,
      riskLevel: "low",
      autoStatus: "pending",
      providerRef: null,
      idNumberHmac: null,
    });

    artifactDeleteSpy = vi
      .fn()
      .mockReturnValue(chainable({ eq: () => Promise.resolve({ error: null }) }));

    // Make verification_steps save FAIL in the current update-then-insert flow
    updateStepSpy = vi.fn().mockReturnValue(
      chainable({
        eq: () =>
          chainable({
            eq: () =>
              chainable({
                neq: () =>
                  chainable({
                    select: () =>
                      chainable({
                        maybeSingle: () => Promise.resolve({ data: null, error: null }),
                      }),
                  }),
              }),
          }),
      })
    );
    insertStepSpy = vi.fn().mockReturnValue(
      chainable({
        select: () =>
          chainable({
            single: () =>
              Promise.resolve({
                data: null,
                error: { message: "DB connection lost", code: "08006" },
              }),
          }),
      })
    );

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          // .select("id").eq(...).maybeSingle()
          return chainable({
            select: () =>
              chainable({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "profile-1", phone: "+27110000000" },
                  }),
              }),
          });
        }
        if (table === "verification_steps") {
          return {
            // Guard query: .select("status").eq().eq().maybeSingle()
            select: () =>
              chainable({
                maybeSingle: () => Promise.resolve({ data: null }),
              }),
            update: updateStepSpy,
            insert: insertStepSpy,
          };
        }
        if (table === "kyc_artifacts") {
          return {
            insert: () =>
              chainable({
                select: () =>
                  chainable({
                    single: () => Promise.resolve({ data: { id: ARTIFACT_ID }, error: null }),
                  }),
              }),
            // Supersede old artifacts: .update().eq().eq().neq().in()
            update: () =>
              chainable({
                in: () => Promise.resolve({ error: null }),
              }),
            delete: artifactDeleteSpy,
          };
        }
        if (table === "verification_sessions") {
          return chainable({
            upsert: () => Promise.resolve({ error: null }),
          });
        }
        // Fallback
        return chainable({
          maybeSingle: () => Promise.resolve({ data: null }),
        });
      }),
    });
  });

  it("returns 500 and cleans up R2 file when verification_steps upsert fails", async () => {
    const res = await POST(createUploadRequest());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("step_upsert_failed");

    // R2 file must be cleaned up
    expect(mockDeleteFromR2).toHaveBeenCalledWith(
      expect.any(String), // bucket name
      R2_KEY
    );
  });

  it("cleans up kyc_artifacts row when verification_steps upsert fails", async () => {
    await POST(createUploadRequest());

    expect(artifactDeleteSpy).toHaveBeenCalled();
  });
});

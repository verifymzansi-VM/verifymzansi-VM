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
  mockIsFeatureEnabled,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
  mockUploadKycDocument: vi.fn(),
  mockDeleteFromR2: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockProcessKycArtifact: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
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

vi.mock("@/lib/services/feature-flags", () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock("@/lib/utils/file-validation", () => ({
  validateBufferIntegrity: vi
    .fn()
    .mockReturnValue({ valid: true, detectedMime: "image/jpeg", mismatch: false }),
}));

import { POST } from "./route";

// ── Helpers ──────────────────────────────────────────────────

function createProofRequest(file: File, province: string, city: string) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("province", province);
  formData.append("city", city);
  return {
    formData: async () => formData,
    nextUrl: new URL("http://localhost/api/verification/location/proof"),
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

function mockAuth(user: { id: string } | null) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: "Not authenticated" },
      }),
    },
  });
}

function setupDefaultMocks() {
  mockFrom.mockImplementation((table: string) => {
    if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
          }),
        }),
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          if (payload.account_verification_status || payload.account_verification_status) {
            return {
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null }),
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
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: "step-1" }, error: null }),
          }),
        }),
      };
    }
    if (table === "verification_sessions") {
      return { upsert: vi.fn().mockResolvedValue({ error: null }) };
    }
    return {};
  });

  mockUploadKycDocument.mockResolvedValue({
    url: "https://r2.example.com/key",
    key: "kyc/proof/user-1/file.bin",
  });

  mockProcessKycArtifact.mockResolvedValue({
    sha256: "abc123",
    riskScore: 0,
    riskLevel: "low",
    providerRef: undefined,
    autoStatus: "needs_manual_review",
  });

  mockLogAuditEvent.mockResolvedValue(undefined);
  mockIsFeatureEnabled.mockResolvedValue(true);
}

// ── Tests ────────────────────────────────────────────────────

describe("POST /api/verification/location/proof", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ from: mockFrom });
    setupDefaultMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockAuth(null);
    const file = new File(["test"], "proof.jpg", { type: "image/jpeg" });
    const response = await POST(createProofRequest(file, "Gauteng", "Johannesburg"));
    expect(response.status).toBe(401);
  });

  it("returns 404 when kyc_gps_location feature flag is disabled", async () => {
    mockAuth({ id: "user-1" });
    mockIsFeatureEnabled.mockResolvedValue(false);
    const file = new File(["test"], "proof.jpg", { type: "image/jpeg" });
    const response = await POST(createProofRequest(file, "Gauteng", "Johannesburg"));
    expect(response.status).toBe(404);
  });

  it("returns 400 when file is missing", async () => {
    mockAuth({ id: "user-1" });
    const formData = new FormData();
    formData.append("province", "Gauteng");
    formData.append("city", "Johannesburg");
    const req = {
      formData: async () => formData,
      nextUrl: new URL("http://localhost/api/verification/location/proof"),
      headers: { get: vi.fn().mockReturnValue(null) },
    } as unknown as NextRequest;
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when province is missing", async () => {
    mockAuth({ id: "user-1" });
    const formData = new FormData();
    formData.append("file", new File(["test"], "proof.jpg", { type: "image/jpeg" }));
    formData.append("city", "Johannesburg");
    const req = {
      formData: async () => formData,
      nextUrl: new URL("http://localhost/api/verification/location/proof"),
      headers: { get: vi.fn().mockReturnValue(null) },
    } as unknown as NextRequest;
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid province", async () => {
    mockAuth({ id: "user-1" });
    const file = new File(["test"], "proof.jpg", { type: "image/jpeg" });
    const response = await POST(createProofRequest(file, "Invalid Province", "Johannesburg"));
    expect(response.status).toBe(400);
  });

  it("always sets auto_status to needs_manual_review", async () => {
    mockAuth({ id: "user-1" });
    const file = new File(["test"], "proof.jpg", { type: "image/jpeg" });
    const response = await POST(createProofRequest(file, "Gauteng", "Johannesburg"));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.artifactId).toBe("artifact-1");
  });

  it("returns 404 when account profile is missing", async () => {
    mockAuth({ id: "user-1" });

    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const file = new File(["test"], "proof.jpg", { type: "image/jpeg" });
    const response = await POST(createProofRequest(file, "Gauteng", "Johannesburg"));
    expect(response.status).toBe(404);
  });

  it("logs audit event on successful upload", async () => {
    mockAuth({ id: "user-1" });
    const file = new File(["test"], "proof.jpg", { type: "image/jpeg" });
    await POST(createProofRequest(file, "Gauteng", "Johannesburg"));

    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kyc_proof_uploaded",
        actorId: "user-1",
      })
    );
  });

  it("clears prior review metadata and reopens the verification session on proof resubmission", async () => {
    mockAuth({ id: "user-1" });

    const stepUpsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "step-1" }, error: null }),
      }),
    });
    const sessionUpsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ error: null }),
            }),
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
        return { upsert: sessionUpsert };
      }
      return {};
    });

    const file = new File(["test"], "proof.jpg", { type: "image/jpeg" });
    const response = await POST(createProofRequest(file, "Gauteng", "Johannesburg"));

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
        location_submitted_at: expect.any(String),
        finalized_at: null,
      }),
      { onConflict: "user_id" }
    );
  });

  it("rolls back proof upload when artifact insert fails", async () => {
    mockAuth({ id: "user-1" });

    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "kyc_artifacts") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
            }),
          }),
        };
      }
      return {};
    });

    mockUploadKycDocument.mockResolvedValue({ url: "u", key: "real-proof-key" });
    mockDeleteFromR2.mockResolvedValue(undefined);

    const file = new File(["test"], "proof.jpg", { type: "image/jpeg" });
    const response = await POST(createProofRequest(file, "Gauteng", "Johannesburg"));

    expect(response.status).toBe(500);
    expect(mockDeleteFromR2).toHaveBeenCalled();
  });
});

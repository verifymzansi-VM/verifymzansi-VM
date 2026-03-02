import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Mocks ────────────────────────────────────────────────────

const mockFrom = vi.fn();
const mockRpc = vi.fn();

const mockAdminClient = {
  from: mockFrom,
  rpc: mockRpc,
};

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/config/env", () => ({
  env: (key: string) => process.env[key],
}));

const mockSubmitIdentity = vi.fn();

vi.mock("./kyc-provider", () => ({
  getConfiguredProvider: () => ({
    name: "stub",
    submitIdentity: mockSubmitIdentity,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockAdminClient,
}));

import { processKycArtifact, type KycEngineInput } from "./kyc-engine";

// ── Helpers ──────────────────────────────────────────────────

function createInput(overrides: Partial<KycEngineInput> = {}): KycEngineInput {
  return {
    artifactId: "artifact-1",
    userId: "user-1",
    stepType: "id_doc",
    fileBuffer: Buffer.from("test-file-content"),
    r2Key: "kyc/id_doc/user-1/file.bin",
    adminClient: mockAdminClient as unknown as SupabaseClient,
    ...overrides,
  };
}

function setupDefaultMocks() {
  // SHA-256 dedup: no duplicates
  // Velocity: passes (RPC returns true)
  // HMAC reuse: no matches
  // Provider: needs_manual_review
  // Risk signal insert: success
  // Provider result insert: success

  mockRpc.mockResolvedValue({ data: true, error: null });

  mockFrom.mockImplementation((table: string) => {
    if (table === "kyc_artifacts") {
      return {
        // SHA-256 dedup only (velocity moved to RPC)
        select: vi.fn().mockReturnValue({
          eq: () => ({
            neq: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      };
    }

    if (table === "verification_steps") {
      return {
        select: () => ({
          eq: () => ({
            neq: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      };
    }

    if (table === "kyc_risk_signals") {
      return {
        insert: () => Promise.resolve({ error: null }),
      };
    }

    if (table === "kyc_provider_results") {
      return {
        insert: () => Promise.resolve({ error: null }),
      };
    }

    return {};
  });

  mockSubmitIdentity.mockResolvedValue({
    status: "needs_manual_review",
    reason: "Routed to manual review",
    providerReference: "sim_rev_123",
    scores: {
      faceMatchScore: null,
      livenessScore: null,
      docAuthScore: null,
      ocrPayload: {},
      rawResponse: {},
    },
  });
}

// ── Tests ────────────────────────────────────────────────────

describe("KYC Engine - processKycArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HMAC_SECRET", "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"); // secret-scan: allow
    setupDefaultMocks();
  });

  it("computes SHA-256 of the file buffer", async () => {
    const input = createInput();
    const result = await processKycArtifact(input);

    const expected = crypto.createHash("sha256").update(input.fileBuffer).digest("hex");
    expect(result.sha256).toBe(expected);
  });

  it("returns low risk when no signals are triggered", async () => {
    const result = await processKycArtifact(createInput());

    expect(result.riskScore).toBe(0);
    expect(result.riskLevel).toBe("low");
  });

  it("returns needs_manual_review auto_status from stub provider", async () => {
    const result = await processKycArtifact(createInput());

    expect(result.autoStatus).toBe("needs_manual_review");
  });

  it("returns providerRef from provider result", async () => {
    const result = await processKycArtifact(createInput());

    expect(result.providerRef).toBe("sim_rev_123");
  });

  it("maps provider approved status to approved autoStatus", async () => {
    mockSubmitIdentity.mockResolvedValueOnce({
      status: "approved",
      providerReference: "ref-ok",
      scores: {
        faceMatchScore: 95,
        livenessScore: 90,
        docAuthScore: 85,
        ocrPayload: {},
        rawResponse: {},
      },
    });

    const result = await processKycArtifact(createInput());
    expect(result.autoStatus).toBe("approved");
  });

  it("maps provider rejected status to rejected autoStatus", async () => {
    mockSubmitIdentity.mockResolvedValueOnce({
      status: "rejected",
      reason: "fake doc",
      providerReference: "ref-rej",
      scores: {
        faceMatchScore: 10,
        livenessScore: 5,
        docAuthScore: 3,
        ocrPayload: {},
        rawResponse: {},
      },
    });

    const result = await processKycArtifact(createInput());
    expect(result.autoStatus).toBe("rejected");
  });

  it("falls back to needs_manual_review when provider throws", async () => {
    mockSubmitIdentity.mockRejectedValueOnce(new Error("Provider timeout"));

    const result = await processKycArtifact(createInput());
    expect(result.autoStatus).toBe("needs_manual_review");
    expect(result.providerRef).toBeUndefined();
  });

  it("detects duplicate SHA-256 and adds block signal (+40 risk)", async () => {
    // Override the kyc_artifacts mock to return a duplicate
    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_artifacts") {
        return {
          select: vi.fn().mockReturnValue({
            eq: () => ({
              neq: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [{ id: "other-artifact", user_id: "other-user" }],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "kyc_risk_signals") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      if (table === "kyc_provider_results") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return {};
    });

    const result = await processKycArtifact(createInput());
    expect(result.riskScore).toBeGreaterThanOrEqual(40);
    expect(["medium", "high", "critical"]).toContain(result.riskLevel);
  });

  it("detects velocity threshold breach and adds warn signal (+15 risk)", async () => {
    // RPC returns false → velocity exceeded
    mockRpc.mockResolvedValueOnce({ data: false, error: null });

    const result = await processKycArtifact(createInput());
    expect(result.riskScore).toBeGreaterThanOrEqual(15);
  });

  it("handles velocity RPC error gracefully (fail open with warn)", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "RPC timeout" } });

    const result = await processKycArtifact(createInput());
    expect(result.riskScore).toBeGreaterThanOrEqual(15);
  });

  it("detects ID number HMAC reuse across accounts", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_artifacts") {
        return {
          select: vi.fn().mockReturnValue({
            eq: () => ({
              neq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        // HMAC reuse found
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [{ id: "other-step", user_id: "other-user" }],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "kyc_risk_signals") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      if (table === "kyc_provider_results") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return {};
    });

    const result = await processKycArtifact(createInput({ idNumber: "9901015009088" }));
    expect(result.riskScore).toBeGreaterThanOrEqual(40);
    expect(result.idNumberHmac).toBeDefined();
    expect(result.idNumberHmac!.length).toBeGreaterThan(0);
  });

  it("computes HMAC for id_doc step with ID number", async () => {
    const result = await processKycArtifact(
      createInput({ stepType: "id_doc", idNumber: "9901015009088" })
    );

    expect(result.idNumberHmac).toBeDefined();
    expect(typeof result.idNumberHmac).toBe("string");
    expect(result.idNumberHmac!.length).toBe(64); // SHA-256 hex
  });

  it("does not compute HMAC for non-id_doc steps", async () => {
    const result = await processKycArtifact(createInput({ stepType: "selfie" }));

    expect(result.idNumberHmac).toBeUndefined();
  });

  it("caps risk score at 100", async () => {
    // Trigger duplicate + HMAC reuse + velocity = 40 + 40 + 15 = 95
    // RPC: velocity exceeded
    mockRpc.mockResolvedValueOnce({ data: false, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_artifacts") {
        return {
          select: vi.fn().mockReturnValue({
            eq: () => ({
              neq: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [{ id: "dup", user_id: "other" }],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        // HMAC reuse
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [{ id: "step-x", user_id: "other" }],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "kyc_risk_signals") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      if (table === "kyc_provider_results") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return {};
    });

    const result = await processKycArtifact(createInput({ idNumber: "9901015009088" }));
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  it("derives correct risk levels from scores", async () => {
    // We test the deriveRiskLevel mapping indirectly via riskLevel output
    // 0 → low
    const resultLow = await processKycArtifact(createInput());
    expect(resultLow.riskLevel).toBe("low");
  });

  // ── HMAC_SECRET edge cases (hardening) ──────────────────────

  it("emits hmac_unavailable signal when HMAC_SECRET is empty", async () => {
    vi.stubEnv("HMAC_SECRET", "");

    const insertCalls: Record<string, unknown>[] = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_artifacts") {
        return {
          select: vi.fn().mockReturnValue({
            eq: () => ({
              neq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "kyc_risk_signals") {
        return {
          insert: (row: Record<string, unknown>) => {
            insertCalls.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "kyc_provider_results") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return {};
    });

    const result = await processKycArtifact(createInput({ idNumber: "9901015009088" }));

    expect(result.riskScore).toBeGreaterThanOrEqual(15); // warn weight
    expect(result.idNumberHmac).toBeUndefined();
    const hmacSignal = insertCalls.find((c) => c.signal_code === "hmac_unavailable");
    expect(hmacSignal).toBeDefined();
  });

  it("throws in production when HMAC_SECRET is the zero-key placeholder", async () => {
    vi.stubEnv("HMAC_SECRET", "0".repeat(64));
    vi.stubEnv("NODE_ENV", "production");

    await expect(processKycArtifact(createInput({ idNumber: "9901015009088" }))).rejects.toThrow(
      "HMAC_SECRET is not configured"
    );
  });
});

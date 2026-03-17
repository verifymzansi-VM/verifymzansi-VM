import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// ── Hoisted mocks ────────────────────────────────────────────

const { mockFrom, mockLogAuditEvent } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockLogAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

import { POST } from "./route";

// ── Helpers ──────────────────────────────────────────────────

function createMockRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

const providerResult = {
  id: "pr-1",
  artifact_id: "art-1",
  user_id: "seller-1",
  provider_status: "pending",
};

function pendingStep(overrides: Record<string, unknown> = {}) {
  return {
    id: "step-1",
    status: "pending",
    risk_score: 10,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("POST /api/webhooks/kyc/provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogAuditEvent.mockResolvedValue(undefined);
  });

  it("returns 400 when provider_ref is missing", async () => {
    const res = await POST(createMockRequest({ status: "approved" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Missing provider_ref");
  });

  it("returns 400 for completely empty payload", async () => {
    const res = await POST(createMockRequest({}));
    expect(res.status).toBe(400);
  });

  it("acknowledges unknown provider_ref without error", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_provider_results") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
            }),
          }),
        };
      }
      return {};
    });

    const res = await POST(createMockRequest({ provider_ref: "unknown-ref", status: "approved" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.acknowledged).toBe(true);
    expect(data.warning).toBe("Unknown provider reference");
  });

  it("updates provider result with scores on approval", async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_provider_results") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: providerResult, error: null }),
            }),
          }),
          update: updateMock,
        };
      }
      if (table === "kyc_artifacts") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { step_type: "id_doc" }, error: null }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: pendingStep(),
                  error: null,
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {};
    });

    const res = await POST(
      createMockRequest({
        provider_ref: "ref-1",
        status: "approved",
        scores: { face_match_score: 0.95, liveness_score: 0.9 },
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.acknowledged).toBe(true);
    expect(data.provider_result_id).toBe("pr-1");

    // Check provider result was updated with scores
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_status: "approved",
        face_match_score: 0.95,
        liveness_score: 0.9,
      })
    );
  });

  it("bumps risk +30 on provider rejection", async () => {
    const stepUpdateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_provider_results") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: providerResult, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "kyc_artifacts") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { step_type: "selfie" }, error: null }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: pendingStep({ risk_score: 20 }),
                  error: null,
                }),
              }),
            }),
          }),
          update: stepUpdateMock,
        };
      }
      return {};
    });

    const res = await POST(
      createMockRequest({
        provider_ref: "ref-1",
        status: "rejected",
        reason: "Face mismatch",
      })
    );
    expect(res.status).toBe(200);

    // risk_score should go from 20 → 50, level = medium
    expect(stepUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        auto_status: "rejected",
        risk_score: 50,
        risk_level: "medium",
      })
    );
  });

  it("caps risk score at 100", async () => {
    const stepUpdateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_provider_results") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: providerResult, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "kyc_artifacts") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { step_type: "id_doc" }, error: null }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: pendingStep({ risk_score: 90 }),
                  error: null,
                }),
              }),
            }),
          }),
          update: stepUpdateMock,
        };
      }
      return {};
    });

    const res = await POST(createMockRequest({ provider_ref: "ref-1", status: "rejected" }));
    expect(res.status).toBe(200);

    // 90 + 30 = 120, capped at 100 → critical
    expect(stepUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        risk_score: 100,
        risk_level: "critical",
      })
    );
  });

  it("logs audit event on successful processing", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_provider_results") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: providerResult, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "kyc_artifacts") {
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

    await POST(createMockRequest({ provider_ref: "ref-1", status: "approved" }));

    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kyc_provider_webhook_received",
        actorId: "system",
        targetType: "kyc_provider_result",
        targetId: "pr-1",
      })
    );
  });

  it("does not overwrite an already-decided verification step", async () => {
    const stepUpdateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_provider_results") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: providerResult, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "kyc_artifacts") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { step_type: "id_doc" }, error: null }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: pendingStep({ status: "approved", risk_score: 40 }),
                  error: null,
                }),
              }),
            }),
          }),
          update: stepUpdateMock,
        };
      }
      return {};
    });

    const res = await POST(createMockRequest({ provider_ref: "ref-1", status: "rejected" }));

    expect(res.status).toBe(200);
    expect(stepUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 503 in production without secret and without test mode", async () => {
    const origEnv = process.env.NODE_ENV;
    const origPw = process.env.PLAYWRIGHT_TEST_MODE;
    try {
      // @ts-expect-error -- overriding readonly for test
      process.env.NODE_ENV = "production";
      delete process.env.KYC_WEBHOOK_SECRET;
      delete process.env.PLAYWRIGHT_TEST_MODE;
      const res = await POST(createMockRequest({ provider_ref: "ref-1", status: "approved" }));
      expect(res.status).toBe(503);
    } finally {
      // @ts-expect-error -- restoring readonly
      process.env.NODE_ENV = origEnv;
      process.env.PLAYWRIGHT_TEST_MODE = origPw;
    }
  });

  it("bypasses 503 in production when PLAYWRIGHT_TEST_MODE=1", async () => {
    const origEnv = process.env.NODE_ENV;
    const origPw = process.env.PLAYWRIGHT_TEST_MODE;
    try {
      // @ts-expect-error -- overriding readonly for test
      process.env.NODE_ENV = "production";
      delete process.env.KYC_WEBHOOK_SECRET;
      process.env.PLAYWRIGHT_TEST_MODE = "1";
      const res = await POST(createMockRequest({}));
      // Should hit payload validation (400) instead of 503
      expect(res.status).toBe(400);
    } finally {
      // @ts-expect-error -- restoring readonly
      process.env.NODE_ENV = origEnv;
      process.env.PLAYWRIGHT_TEST_MODE = origPw;
    }
  });

  it("sets auto_status to needs_manual_review for ambiguous result", async () => {
    const stepUpdateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "kyc_provider_results") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: providerResult, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "kyc_artifacts") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { step_type: "selfie" }, error: null }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: pendingStep(),
                  error: null,
                }),
              }),
            }),
          }),
          update: stepUpdateMock,
        };
      }
      return {};
    });

    const res = await POST(
      createMockRequest({ provider_ref: "ref-1", status: "needs_manual_review" })
    );
    expect(res.status).toBe(200);

    expect(stepUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        auto_status: "needs_manual_review",
        risk_score: 10, // no bump for manual review
      })
    );
  });
});

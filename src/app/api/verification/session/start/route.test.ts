import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const CSRF_TOKEN = "a".repeat(64);

// ── Hoisted mocks ────────────────────────────────────────────

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFrom,
  mockIsFeatureEnabled,
  mockLogAuditEvent,
  mockCheckRateLimit,
  mockGetClientIp,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/services/feature-flags", () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

import { POST } from "./route";

// ── Helpers ──────────────────────────────────────────────────

function createMockRequest(origin?: string) {
  return new NextRequest("http://localhost/api/verification/session/start", {
    method: "POST",
    headers: {
      ...(origin ? { origin } : {}),
      cookie: `${origin ? "" : ""}vm_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    },
  });
}

function createMissingCsrfRequest(origin = "http://localhost") {
  return new NextRequest("http://localhost/api/verification/session/start", {
    method: "POST",
    headers: { origin },
  });
}

/** Build a fluent Supabase select chain: .select().eq().is().order().limit().maybeSingle() */
function mockSessionSelectChain(resolvedValue: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue(resolvedValue),
            }),
          }),
        }),
      }),
    }),
  };
}

/**
 * Mock verification_steps table supporting both:
 * - Phone step lookup: .select("phone_verified_at").eq().eq().in().maybeSingle()
 * - All steps query: .select("step_type, status").eq() (returns { data, error } directly)
 */
function mockStepsTable({
  phoneStep = null,
  allSteps = [],
}: {
  phoneStep?: unknown;
  allSteps?: unknown[];
}) {
  return {
    select: vi.fn().mockImplementation((cols: string) => {
      if (cols.includes("phone_verified_at")) {
        // Phone step lookup chain
        return {
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: phoneStep, error: null }),
              }),
            }),
          }),
        };
      }
      // All steps query
      return {
        eq: vi.fn().mockResolvedValue({ data: allSteps, error: null }),
      };
    }),
  };
}

function mockAuth(user: { id: string; email_confirmed_at?: string | null } | null) {
  mockCreateClient.mockResolvedValue({
    from: mockFrom,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: user
            ? {
                ...user,
                email_confirmed_at:
                  "email_confirmed_at" in user ? user.email_confirmed_at : new Date().toISOString(),
              }
            : null,
        },
        error: user ? null : { message: "Not authenticated" },
      }),
    },
  });
}

describe("POST /api/verification/session/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ from: mockFrom });
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
  });

  it("rejects cross-site session-start requests", async () => {
    const response = await POST(createMockRequest("https://evil.example"));
    expect(response.status).toBe(403);
  });

  it("rejects session-start requests without a CSRF token", async () => {
    const response = await POST(createMissingCsrfRequest());
    expect(response.status).toBe(403);
  });

  it("returns 503 when shared session protection is unavailable", async () => {
    mockAuth({ id: "user-1" });
    mockCheckRateLimit.mockResolvedValue({ limited: true, degraded: true, retryAfter: 30 });

    const response = await POST(createMockRequest("http://localhost"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("returns 401 when user is not authenticated", async () => {
    mockAuth(null);
    const response = await POST(createMockRequest());
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 404 when kyc_v2_flow feature flag is disabled", async () => {
    mockAuth({ id: "user-1" });
    mockIsFeatureEnabled.mockResolvedValue(false);

    const response = await POST(createMockRequest());
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain("not yet enabled");
  });

  it("returns 403 when user has not confirmed their email", async () => {
    mockAuth({ id: "user-1", email_confirmed_at: null });

    const response = await POST(createMockRequest());
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("confirm your email");
  });

  it("creates a new session when none exists", async () => {
    mockAuth({ id: "user-1" });

    const newSession = {
      id: "session-1",
      user_id: "user-1",
      created_at: new Date().toISOString(),
      phone_verified_at: null,
      id_artifact_id: null,
      selfie_artifact_id: null,
      location_submitted_at: null,
      finalized_at: null,
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_sessions") {
        return {
          ...mockSessionSelectChain({ data: null, error: { code: "PGRST116" } }),
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: newSession, error: null }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return mockStepsTable({ phoneStep: null, allSteps: [] });
      }
      return {};
    });

    const response = await POST(createMockRequest());
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.sessionId).toBe("session-1");
    expect(data.requiredSteps).toEqual(["phone", "id_doc", "selfie", "location"]);
    expect(data.completedSteps).toEqual([]);
    expect(data.pendingSteps).toEqual([]);
    expect(data.rejectedSteps).toEqual([]);
    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      key: "user-1",
      action: "verification:session-start",
      degradedMode: "block",
    });
    expect(mockGetClientIp).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kyc_session_started",
        actorId: "user-1",
      })
    );
  });

  it("resumes existing session without creating a new one", async () => {
    mockAuth({ id: "user-1" });

    const existingSession = {
      id: "session-existing",
      user_id: "user-1",
      created_at: new Date().toISOString(),
      phone_verified_at: new Date().toISOString(),
      id_artifact_id: null,
      selfie_artifact_id: null,
      location_submitted_at: null,
      finalized_at: null,
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_sessions") {
        return mockSessionSelectChain({ data: existingSession, error: null });
      }
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { step_type: "phone", status: "approved" },
                { step_type: "id_doc", status: "pending" },
              ],
              error: null,
            }),
          }),
        };
      }
      return {};
    });

    const response = await POST(createMockRequest());
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.sessionId).toBe("session-existing");
    expect(data.completedSteps).toEqual(["phone"]);
    expect(data.pendingSteps).toEqual(["id_doc"]);
    expect(data.phoneVerifiedAt).toBeDefined();
    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      key: "user-1",
      action: "verification:session-start",
      degradedMode: "block",
    });
    // Should NOT log session started for existing sessions
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 500 when session creation fails", async () => {
    mockAuth({ id: "user-1" });

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_sessions") {
        return {
          ...mockSessionSelectChain({ data: null, error: { code: "PGRST116" } }),
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return mockStepsTable({ phoneStep: null, allSteps: [] });
      }
      return {};
    });

    const response = await POST(createMockRequest());
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain("Failed to create");
  });

  it("classifies rejected and needs_resubmission steps correctly", async () => {
    mockAuth({ id: "user-1" });

    const session = {
      id: "session-1",
      user_id: "user-1",
      created_at: new Date().toISOString(),
      phone_verified_at: null,
      id_artifact_id: null,
      selfie_artifact_id: null,
      location_submitted_at: null,
      finalized_at: null,
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_sessions") {
        return mockSessionSelectChain({ data: session, error: null });
      }
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { step_type: "phone", status: "approved" },
                { step_type: "id_doc", status: "rejected" },
                { step_type: "selfie", status: "needs_resubmission" },
              ],
              error: null,
            }),
          }),
        };
      }
      return {};
    });

    const response = await POST(createMockRequest());
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.completedSteps).toEqual(["phone"]);
    expect(data.rejectedSteps).toContain("id_doc");
    expect(data.rejectedSteps).toContain("selfie");
  });

  it("resets expired session in-place and preserves phone_verified_at", async () => {
    mockAuth({ id: "user-1" });

    const expiredCreatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const phoneVerifiedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const expiredSession = {
      id: "session-expired",
      user_id: "user-1",
      created_at: expiredCreatedAt,
      phone_verified_at: null,
      id_artifact_id: "old-artifact",
      selfie_artifact_id: null,
      location_submitted_at: null,
      finalized_at: null,
    };

    const resetSession = {
      id: "session-expired",
      user_id: "user-1",
      created_at: new Date().toISOString(),
      phone_verified_at: phoneVerifiedAt,
      id_artifact_id: null,
      selfie_artifact_id: null,
      location_submitted_at: null,
      finalized_at: null,
    };

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: resetSession, error: null }),
        }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_sessions") {
        return {
          ...mockSessionSelectChain({ data: expiredSession, error: null }),
          update: mockUpdate,
        };
      }
      if (table === "verification_steps") {
        return mockStepsTable({
          phoneStep: { phone_verified_at: phoneVerifiedAt },
          allSteps: [{ step_type: "phone", status: "approved" }],
        });
      }
      return {};
    });

    const response = await POST(createMockRequest());
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.sessionId).toBe("session-expired");
    expect(data.phoneVerifiedAt).toBe(phoneVerifiedAt);
    expect(data.completedSteps).toEqual(["phone"]);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kyc_session_started",
        actorId: "user-1",
      })
    );
  });

  it("includes expiresAt as 24h after session creation", async () => {
    mockAuth({ id: "user-1" });

    // Use a recent but not-expired created_at (now minus 1 hour)
    const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const session = {
      id: "session-1",
      user_id: "user-1",
      created_at: createdAt,
      phone_verified_at: null,
      id_artifact_id: null,
      selfie_artifact_id: null,
      location_submitted_at: null,
      finalized_at: null,
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_sessions") {
        return {
          ...mockSessionSelectChain({ data: session, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      return {};
    });

    const response = await POST(createMockRequest());
    const data = await response.json();

    const expected = new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
    expect(data.expiresAt).toBe(expected);
  });
});

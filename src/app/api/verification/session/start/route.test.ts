import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted mocks ────────────────────────────────────────────

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockFrom,
  mockIsFeatureEnabled,
  mockLogAuditEvent,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockLogAuditEvent: vi.fn(),
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

import { POST } from "./route";

// ── Helpers ──────────────────────────────────────────────────

function createMockRequest() {
  return new NextRequest("http://localhost/api/verification/session/start", {
    method: "POST",
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

describe("POST /api/verification/session/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ from: mockFrom });
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockLogAuditEvent.mockResolvedValue(undefined);
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
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: newSession, error: null }),
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
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.sessionId).toBe("session-1");
    expect(data.requiredSteps).toEqual(["phone", "id_doc", "selfie", "location"]);
    expect(data.completedSteps).toEqual([]);
    expect(data.pendingSteps).toEqual([]);
    expect(data.rejectedSteps).toEqual([]);
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
    // Should NOT log session started for existing sessions
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 500 when session creation fails", async () => {
    mockAuth({ id: "user-1" });

    mockFrom.mockImplementation((table: string) => {
      if (table === "verification_sessions") {
        return {
          ...mockSessionSelectChain({ data: null, error: { code: "PGRST116" } }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
            }),
          }),
        };
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

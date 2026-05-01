import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockVerifyAdminActorRoleFromDb,
  mockGetRoleFromUser,
  mockRecordRoleChange,
  mockCheckLocalRateLimit,
  mockEnforceSameOriginMutation,
  mockEnforceCsrfToken,
  mockListUsers,
  mockUpdateUserById,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockVerifyAdminActorRoleFromDb: vi.fn(),
  mockGetRoleFromUser: vi.fn(),
  mockRecordRoleChange: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn<(request: Request) => Response | null>(() => null),
  mockEnforceCsrfToken: vi.fn<(request: Request) => Response | null>(() => null),
  mockListUsers: vi.fn(),
  mockUpdateUserById: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyAdminActorRoleFromDb: mockVerifyAdminActorRoleFromDb,
}));

vi.mock("@/lib/auth/roles", () => ({
  getRoleFromUser: mockGetRoleFromUser,
}));

vi.mock("@/lib/services/decision-ledger", () => ({
  recordRoleChange: mockRecordRoleChange,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: mockEnforceCsrfToken,
}));

import { POST } from "./route";

// ── Helpers ──────────────────────────────────────────────────

const ADMIN_USER = {
  id: "admin-1",
  email: "admin@example.com",
  app_metadata: { role: "admin" },
};

const TARGET_USER = {
  id: "target-1",
  email: "target@example.com",
  app_metadata: { role: "member" },
};

function createMockRequest(body: Record<string, unknown>): Request {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
    headers: new Headers(),
    url: "https://verifymzansi.com/api/admin/governance/roles",
  } as unknown as Request;
}

function validBody(overrides?: Partial<{ targetEmail: string; newRole: string; reason: string }>) {
  return {
    targetEmail: TARGET_USER.email,
    newRole: "moderator",
    reason: "Promoting to moderator for content moderation duties",
    ...overrides,
  };
}

function setupHappyPath() {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: ADMIN_USER } }),
    },
  });
  mockVerifyAdminActorRoleFromDb.mockResolvedValue("admin");
  mockCheckLocalRateLimit.mockReturnValue({ limited: false });
  mockGetRoleFromUser.mockReturnValue("member");
  mockRecordRoleChange.mockResolvedValue(undefined);

  mockListUsers.mockResolvedValue({
    data: { users: [TARGET_USER] },
    error: null,
  });
  mockUpdateUserById.mockResolvedValue({ error: null });

  mockCreateAdminClient.mockReturnValue({
    auth: {
      admin: {
        listUsers: mockListUsers,
        updateUserById: mockUpdateUserById,
      },
    },
  });
}

// ── Tests ────────────────────────────────────────────────────

describe("POST /api/admin/governance/roles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockEnforceCsrfToken.mockReturnValue(null);
    setupHappyPath();
  });

  // ── Security layer tests ───────────────────────────────

  describe("L1: Same-origin enforcement", () => {
    it("blocks cross-origin requests", async () => {
      const blocked = new Response(JSON.stringify({ error: "Origin mismatch" }), { status: 403 });
      mockEnforceSameOriginMutation.mockReturnValue(blocked);

      const res = await POST(createMockRequest(validBody()));

      expect(res.status).toBe(403);
      expect(mockVerifyAdminActorRoleFromDb).not.toHaveBeenCalled();
    });
  });

  describe("L2: CSRF enforcement", () => {
    it("blocks requests with invalid CSRF token", async () => {
      const blocked = new Response(JSON.stringify({ error: "Invalid CSRF token" }), {
        status: 403,
      });
      mockEnforceCsrfToken.mockReturnValue(blocked);

      const res = await POST(createMockRequest(validBody()));

      expect(res.status).toBe(403);
      expect(mockVerifyAdminActorRoleFromDb).not.toHaveBeenCalled();
    });
  });

  describe("Authentication", () => {
    it("returns 401 for unauthenticated requests", async () => {
      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
      });

      const res = await POST(createMockRequest(validBody()));
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("L3: DB-verified admin role", () => {
    it("returns 403 when user is not a verified admin", async () => {
      mockVerifyAdminActorRoleFromDb.mockResolvedValue(null);

      const res = await POST(createMockRequest(validBody()));
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toBe("Forbidden");
    });

    it("returns 403 for a moderator", async () => {
      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: "moderator-1",
                email: "moderator@example.com",
                app_metadata: { role: "moderator" },
              },
            },
          }),
        },
      });
      mockVerifyAdminActorRoleFromDb.mockResolvedValue(null);

      const res = await POST(createMockRequest(validBody()));
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toBe("Forbidden");
      expect(mockUpdateUserById).not.toHaveBeenCalled();
    });

    it("returns 403 for governance controllers", async () => {
      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: "governance-1",
                email: "governance@example.com",
                app_metadata: { role: "governance_controller" },
              },
            },
          }),
        },
      });
      mockVerifyAdminActorRoleFromDb.mockResolvedValue(null);

      const res = await POST(createMockRequest(validBody()));
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toBe("Forbidden");
      expect(mockUpdateUserById).not.toHaveBeenCalled();
    });
  });

  describe("L5: Rate limiting", () => {
    it("returns 429 when rate limit is exceeded", async () => {
      mockCheckLocalRateLimit.mockReturnValue({ limited: true, retryAfter: 45 });

      const res = await POST(createMockRequest(validBody()));
      const data = await res.json();

      expect(res.status).toBe(429);
      expect(data.error).toContain("Too many requests");
      expect(res.headers.get("Retry-After")).toBe("45");
    });
  });

  // ── Validation tests ───────────────────────────────────

  describe("Input validation", () => {
    it("rejects missing targetEmail", async () => {
      const res = await POST(createMockRequest({ newRole: "moderator", reason: "test reason" }));
      expect(res.status).toBe(400);
    });

    it("rejects invalid email format", async () => {
      const res = await POST(createMockRequest(validBody({ targetEmail: "not-an-email" })));
      expect(res.status).toBe(400);
    });

    it("rejects invalid role value", async () => {
      const res = await POST(createMockRequest(validBody({ newRole: "superadmin" })));
      expect(res.status).toBe(400);
    });

    it("rejects reason shorter than 5 chars", async () => {
      const res = await POST(createMockRequest(validBody({ reason: "hi" })));
      expect(res.status).toBe(400);
    });
  });

  // ── Business logic tests ───────────────────────────────

  describe("Business rules", () => {
    it("blocks self-role-change", async () => {
      const res = await POST(createMockRequest(validBody({ targetEmail: ADMIN_USER.email })));
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Cannot change your own role");
    });

    it("returns 404 when target user does not exist", async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [] },
        error: null,
      });

      const res = await POST(createMockRequest(validBody()));
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe("Target user not found");
    });

    it("returns 409 when user already has the requested role", async () => {
      mockGetRoleFromUser.mockReturnValue("moderator");

      const res = await POST(createMockRequest(validBody({ newRole: "moderator" })));
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error).toBe("User already has the requested role");
    });

    it("returns 409 when demoting member to member", async () => {
      mockGetRoleFromUser.mockReturnValue("member");

      const res = await POST(createMockRequest(validBody({ newRole: "member" })));
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error).toBe("User already has the requested role");
    });
  });

  // ── Happy path ─────────────────────────────────────────

  describe("Successful role assignment", () => {
    it("updates user role and records audit trail", async () => {
      const res = await POST(createMockRequest(validBody()));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe("ok");
      expect(data.targetUserId).toBe(TARGET_USER.id);
      expect(data.previousRole).toBe("member");
      expect(data.newRole).toBe("moderator");

      // Verify updateUserById was called with correct role metadata
      expect(mockUpdateUserById).toHaveBeenCalledWith(TARGET_USER.id, {
        app_metadata: { ...TARGET_USER.app_metadata, role: "moderator" },
      });

      // Verify audit trail was recorded
      expect(mockRecordRoleChange).toHaveBeenCalledWith({
        targetUserId: TARGET_USER.id,
        previousRole: "member",
        newRole: "moderator",
        assignedBy: ADMIN_USER.id,
        assignerRole: "admin",
        reason: "Promoting to moderator for content moderation duties",
      });
    });

    it("correctly handles demotion to member", async () => {
      mockGetRoleFromUser
        .mockReturnValueOnce("moderator") // for currentRole
        .mockReturnValueOnce("admin"); // for actorRole

      const targetWithRole = { ...TARGET_USER, app_metadata: { role: "moderator" } };
      mockListUsers.mockResolvedValue({
        data: { users: [targetWithRole] },
        error: null,
      });

      const res = await POST(createMockRequest(validBody({ newRole: "member" })));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.newRole).toBe("member");
      expect(mockUpdateUserById).toHaveBeenCalledWith(TARGET_USER.id, {
        app_metadata: { role: "member" },
      });
    });

    it("assigns governance_controller role", async () => {
      const res = await POST(createMockRequest(validBody({ newRole: "governance_controller" })));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.newRole).toBe("governance_controller");
    });
  });

  // ── Error handling ─────────────────────────────────────

  describe("Error handling", () => {
    it("returns 500 when listUsers fails", async () => {
      mockListUsers.mockResolvedValue({
        data: null,
        error: { message: "DB connection lost" },
      });

      const res = await POST(createMockRequest(validBody()));

      expect(res.status).toBe(500);
    });

    it("returns 500 when updateUserById fails", async () => {
      mockUpdateUserById.mockResolvedValue({
        error: { message: "Update failed" },
      });

      const res = await POST(createMockRequest(validBody()));

      expect(res.status).toBe(500);
    });

    it("does not expose PII in successful response", async () => {
      const res = await POST(createMockRequest(validBody()));
      const data = await res.json();

      expect(data.email).toBeUndefined();
      expect(data.targetEmail).toBeUndefined();
      expect(JSON.stringify(data)).not.toContain("@example.com");
    });
  });

  // ── Security enforcement order ─────────────────────────

  describe("Security layer ordering", () => {
    it("checks same-origin before CSRF", async () => {
      const callOrder: string[] = [];
      mockEnforceSameOriginMutation.mockImplementation(() => {
        callOrder.push("origin");
        return null;
      });
      mockEnforceCsrfToken.mockImplementation(() => {
        callOrder.push("csrf");
        return null;
      });

      await POST(createMockRequest(validBody()));

      expect(callOrder.indexOf("origin")).toBeLessThan(callOrder.indexOf("csrf"));
    });

    it("checks DB admin verification before rate limit", async () => {
      mockVerifyAdminActorRoleFromDb.mockResolvedValue(null);

      await POST(createMockRequest(validBody()));

      // Should fail at DB admin verification, never reach rate limit
      expect(mockCheckLocalRateLimit).not.toHaveBeenCalled();
    });
  });
});

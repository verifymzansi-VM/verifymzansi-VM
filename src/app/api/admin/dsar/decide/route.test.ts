import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockLogAuditEvent,
  mockCheckLocalRateLimit,
  mockVerifyCapabilityRoleFromDb,
  mockEnforceSameOriginMutation,
  mockEnforceCsrfToken,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockVerifyCapabilityRoleFromDb: vi.fn<
    () => Promise<"moderator" | "governance_controller" | "admin" | null>
  >(async () => "admin"),
  mockEnforceSameOriginMutation: vi.fn<(request: Request) => Response | null>(() => null),
  mockEnforceCsrfToken: vi.fn<(request: Request) => Response | null>(() => null),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyCapabilityRoleFromDb: mockVerifyCapabilityRoleFromDb,
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

function createMockRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
  } as unknown as Request;
}

describe("POST /api/admin/dsar/decide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
        }),
      },
    });
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockVerifyCapabilityRoleFromDb.mockResolvedValue("admin");
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockEnforceCsrfToken.mockReturnValue(null);
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [{ id: "case-1" }], error: null }),
            }),
          }),
        }),
      }),
    });
  });

  it("rejects cross-origin DSAR decisions before auth or DB access", async () => {
    mockEnforceSameOriginMutation.mockReturnValue(
      new Response(JSON.stringify({ error: "Cross-origin request blocked" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await POST(
      createMockRequest({
        requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        decision: "approve",
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Cross-origin request blocked" });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("logs dsar_started when an admin approves a request", async () => {
    const requestId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

    const response = await POST(
      createMockRequest({
        requestId,
        decision: "approve",
        notes: "Initial validation complete",
      })
    );

    expect(response.status).toBe(200);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsar_started",
        actorRole: "admin",
        targetId: requestId,
      })
    );
  });

  it("rejects CSRF-invalid requests before auth", async () => {
    mockEnforceCsrfToken.mockReturnValue(
      new Response(JSON.stringify({ error: "CSRF token invalid" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await POST(
      createMockRequest({
        requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        decision: "approve",
      })
    );

    expect(response.status).toBe(403);
  });

  it("returns 401 when no user is authenticated", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const response = await POST(
      createMockRequest({
        requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        decision: "approve",
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when user lacks dsar:manage capability", async () => {
    mockVerifyCapabilityRoleFromDb.mockResolvedValueOnce(null);

    const response = await POST(
      createMockRequest({
        requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        decision: "approve",
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("uses the DB-verified role in the DSAR audit log", async () => {
    const requestId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    mockVerifyCapabilityRoleFromDb.mockResolvedValueOnce("governance_controller");

    const response = await POST(
      createMockRequest({
        requestId,
        decision: "approve",
        notes: "DB role should be logged",
      })
    );

    expect(response.status).toBe(200);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsar_started",
        actorRole: "governance_controller",
        targetId: requestId,
      })
    );
  });

  it("returns 429 when rate limited", async () => {
    mockCheckLocalRateLimit.mockReturnValue({ limited: true, retryAfter: 60 });

    const response = await POST(
      createMockRequest({
        requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        decision: "approve",
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("sets status to 'rejected' for reject decisions", async () => {
    const requestId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

    const response = await POST(
      createMockRequest({
        requestId,
        decision: "reject",
        notes: "Insufficient basis for the request",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "rejected" });
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsar_rejected",
        targetId: requestId,
      })
    );
  });

  it("returns 409 when request is already processed", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    });

    const response = await POST(
      createMockRequest({
        requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        decision: "approve",
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Request not found or already processed",
    });
  });

  it("returns 500 on DB error", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "connection refused" },
              }),
            }),
          }),
        }),
      }),
    });

    const response = await POST(
      createMockRequest({
        requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        decision: "approve",
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to update DSAR request",
    });
  });
});

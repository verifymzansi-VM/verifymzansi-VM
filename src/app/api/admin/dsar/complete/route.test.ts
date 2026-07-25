import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockLogAuditEvent,
  mockCheckLocalRateLimit,
  mockSendDsarCompletedEmail,
  mockVerifyAdminActorRoleFromDb,
  mockVerifyCapabilityRoleFromDb,
  mockEnforceSameOriginMutation,
  mockEnforceCsrfToken,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockSendDsarCompletedEmail: vi.fn().mockResolvedValue({ success: true }),
  mockVerifyAdminActorRoleFromDb: vi.fn<(user: unknown) => Promise<string | null>>(
    async () => "admin"
  ),
  mockVerifyCapabilityRoleFromDb: vi.fn<
    (user: unknown, capability: unknown) => Promise<string | null>
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

vi.mock("@/lib/services/email", () => ({
  sendDsarCompletedEmail: mockSendDsarCompletedEmail,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyAdminActorRoleFromDb: mockVerifyAdminActorRoleFromDb,
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

describe("POST /api/admin/dsar/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockEnforceCsrfToken.mockReturnValue(null);
    mockVerifyAdminActorRoleFromDb.mockResolvedValue("admin");
    mockVerifyCapabilityRoleFromDb.mockResolvedValue("admin");
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
        }),
      },
    });
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "case-1",
                type: "access",
                status: "in_progress",
                identity_verified: true,
              },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: [{ id: "case-1", requester_email: "requester@example.com" }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    });
  });

  it("rejects cross-origin requests before auth checks", async () => {
    mockEnforceSameOriginMutation.mockReturnValue(
      new Response(JSON.stringify({ error: "Cross-origin blocked" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await POST(
      createMockRequest({
        requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        notes: "ignored",
      })
    );

    expect(response.status).toBe(403);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("returns 401 when no authenticated user is present", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const response = await POST(
      createMockRequest({ requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when actor role validation fails", async () => {
    mockVerifyCapabilityRoleFromDb.mockResolvedValue(null);

    const response = await POST(
      createMockRequest({ requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns 429 when local admin rate limit is hit", async () => {
    mockCheckLocalRateLimit.mockReturnValue({ limited: true, retryAfter: 15 });

    const response = await POST(
      createMockRequest({ requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("15");
  });

  it("returns 400 for invalid request payload", async () => {
    const response = await POST(createMockRequest({ requestId: "not-a-uuid" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid request" });
  });

  it("returns 500 when DSAR completion DB update fails", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "case-1",
                type: "access",
                status: "in_progress",
                identity_verified: true,
              },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "db offline" },
              }),
            }),
          }),
        }),
      }),
    });

    const response = await POST(
      createMockRequest({ requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Failed to complete DSAR request" });
  });

  it("returns 409 when request is not in progress", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "case-1",
                type: "access",
                status: "in_progress",
                identity_verified: true,
              },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          }),
        }),
      }),
    });

    const response = await POST(
      createMockRequest({ requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Request not found or not ready for completion",
    });
  });

  it("logs dsar_completed when an admin completes a request", async () => {
    const requestId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

    const response = await POST(
      createMockRequest({
        requestId,
        notes: "Export package delivered securely",
      })
    );

    expect(response.status).toBe(200);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsar_completed",
        actorRole: "admin",
        targetId: requestId,
      })
    );
    expect(mockSendDsarCompletedEmail).toHaveBeenCalledWith(
      "requester@example.com",
      expect.stringContaining("DSAR-"),
      "Export package delivered securely"
    );
  });

  it("returns 500 on unexpected exception", async () => {
    mockCreateClient.mockRejectedValue(new Error("unexpected failure"));

    const response = await POST(
      createMockRequest({ requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
  });
});

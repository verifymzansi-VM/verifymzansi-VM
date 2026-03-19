import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockLogAuditEvent,
  mockCheckLocalRateLimit,
  mockEnforceSameOriginMutation,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn(() => null),
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

vi.mock("@/lib/auth/roles", () => ({
  isAdmin: () => true,
  getRoleFromUser: () => "admin",
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
    mockEnforceSameOriginMutation.mockReturnValue(null);
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
});

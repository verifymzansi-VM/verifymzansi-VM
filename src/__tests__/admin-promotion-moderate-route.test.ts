import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockLogAuditEvent,
  mockLoggerError,
  mockEnforceSameOriginMutation,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
  mockLoggerError: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn(() => null),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ error: mockLoggerError, info: vi.fn(), warn: vi.fn() }),
}));
vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));

import { POST } from "@/app/api/admin/promotions/[id]/moderate/route";

const VALID_UUID = "00000000-0000-4000-8000-000000000001";

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL(`http://localhost:3000/api/admin/promotions/${VALID_UUID}/moderate`),
  } as unknown as NextRequest;
}

function createParams(id = VALID_UUID) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/promotions/[id]/moderate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "admin-1",
              app_metadata: { role: "admin" },
              is_anonymous: false,
            },
          },
        }),
      },
    });
  });

  it("rejects cross-origin moderation requests before auth or validation", async () => {
    mockEnforceSameOriginMutation.mockReturnValue(
      new Response(JSON.stringify({ error: "Cross-origin request blocked" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const response = await POST(createRequest({ decision: "approve" }), createParams());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Cross-origin request blocked" });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("rejects invalid promotion ids", async () => {
    const response = await POST(createRequest({ decision: "approve" }), createParams("bad-id"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid promotion ID" });
  });

  it("blocks non-moderators from changing promotion status", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "member-1",
              app_metadata: { role: "member" },
              is_anonymous: false,
            },
          },
        }),
      },
    });

    const response = await POST(createRequest({ decision: "approve" }), createParams());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("returns validation details for malformed moderation bodies", async () => {
    const response = await POST(createRequest({ decision: "invalid" }), createParams());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Validation failed",
      details: {
        decision: expect.any(String),
      },
    });
  });

  it("returns 404 when the promotion does not exist", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      }),
    });

    const response = await POST(createRequest({ decision: "approve" }), createParams());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Promotion not found" });
  });

  it("approves unpublished promotions and stamps published_at", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "mod-1",
              app_metadata: { role: "moderator" },
              is_anonymous: false,
            },
          },
        }),
      },
    });

    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const from = vi.fn((table: string) => {
      if (table === "promotions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: VALID_UUID,
              status: "pending_moderation",
              owner_id: "owner-1",
              title: "Weekend Sale",
              published_at: null,
            },
          }),
          update,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockCreateAdminClient.mockReturnValue({ from });

    const response = await POST(
      createRequest({ decision: "approve", reason: "Looks good" }),
      createParams()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, status: "live" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "live",
        status_reason: "Looks good",
        published_at: expect.any(String),
      })
    );
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "mod-1",
        actorRole: "moderator",
        targetType: "promotion",
        targetId: VALID_UUID,
        metadata: expect.objectContaining({
          decision: "approve",
          reason: "Looks good",
          title: "Weekend Sale",
        }),
      })
    );
  });

  it("returns a safe error when the status update fails", async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        error: { message: "raw db failure" },
      }),
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: VALID_UUID,
            status: "pending_moderation",
            owner_id: "owner-1",
            title: "Weekend Sale",
            published_at: null,
          },
        }),
        update,
      }),
    });

    const response = await POST(createRequest({ decision: "hide" }), createParams());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to moderate promotion",
    });
    expect(mockLoggerError).toHaveBeenCalledWith("Failed to moderate promotion", {
      error: "raw db failure",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockIsModeratorOrAdmin, mockLogAuditEvent } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockIsModeratorOrAdmin: vi.fn(),
    mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/auth/roles", () => ({ isModeratorOrAdmin: mockIsModeratorOrAdmin }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));

import { POST } from "@/app/api/admin/flagging/action/route";

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/admin/flagging/action",
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? headers[name] ?? null;
      },
    },
  } as unknown as NextRequest;
}

describe("POST /api/admin/flagging/action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects cross-site moderation requests", async () => {
    const res = await POST(
      createRequest(
        {
          reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          action: "hide",
        },
        { origin: "https://evil.example" }
      )
    );

    expect(res.status).toBe(403);
  });

  it("returns 403 for non-moderators", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockIsModeratorOrAdmin.mockReturnValue(false);

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "hide",
      })
    );

    expect(res.status).toBe(403);
  });

  it("hides reported content and resolves the report", async () => {
    const reportsEq = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          id: "report-1",
          area: "MZANSI_MARKET",
          target_type: "listing",
          target_id: "listing-1",
        },
        error: null,
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    const listingsEq = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { owner_id: "owner-1" },
        error: null,
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "mod-1", app_metadata: { role: "moderator" } } },
        }),
      },
    });
    mockIsModeratorOrAdmin.mockReturnValue(true);
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "reports") {
          return {
            select: vi.fn().mockReturnValue({
              eq: reportsEq,
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }

        if (table === "listings") {
          return {
            select: vi.fn().mockReturnValue({
              eq: listingsEq,
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }

        if (table === "moderation_actions") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    });

    const res = await POST(
      createRequest({
        reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        action: "hide",
        reason: "Fraud signal",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      action: "hide",
      reportStatus: "resolved",
    });
    expect(mockLogAuditEvent).toHaveBeenCalled();
  });
});

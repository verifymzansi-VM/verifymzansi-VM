import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));

import { POST } from "@/app/api/content/delete/route";

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/content/delete",
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? headers[name] ?? null;
      },
    },
  } as unknown as NextRequest;
}

describe("POST /api/content/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects cross-site delete attempts", async () => {
    const res = await POST(
      createRequest(
        {
          itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          area: "MZANSI_MARKET",
        },
        { origin: "https://evil.example" }
      )
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 when the item cannot be found", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
      }),
    });

    const res = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_MARKET",
      })
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 when the item belongs to a different owner", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: "listing-1", status: "live", owner_id: "user-2" },
          error: null,
        }),
      }),
    });

    const res = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_MARKET",
      })
    );

    expect(res.status).toBe(403);
  });

  it("deletes owned content successfully", async () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: "listing-1", status: "live", owner_id: "user-1" },
            error: null,
          }),
          delete: vi.fn().mockReturnValue({
            eq: deleteEq,
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockCreateAdminClient.mockReturnValue({ from });

    const res = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_MARKET",
      })
    );

    expect(res.status).toBe(200);
    expect(deleteEq).toHaveBeenCalledWith("id", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    expect(mockLogAuditEvent).toHaveBeenCalled();
  });
});

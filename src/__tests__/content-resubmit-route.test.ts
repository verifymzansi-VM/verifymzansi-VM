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
vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: () => ({ limited: false }),
}));

import { POST } from "@/app/api/content/resubmit/route";

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

describe("POST /api/content/resubmit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resubmits MZANSI_BUSINESS items using owner-column compatibility", async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: vi.fn((fields?: string) => {
            if (fields === "id, owner_id") {
              return {
                limit: vi.fn().mockResolvedValue({
                  error: { code: "42703", message: "column businesses.owner_id does not exist" },
                }),
              };
            }

            if (fields === "id, seller_id") {
              return {
                limit: vi.fn().mockResolvedValue({ error: null }),
              };
            }

            return {
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "business-1", status: "rejected", seller_id: "user-1" },
                error: null,
              }),
            };
          }),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "business-1", status: "rejected", seller_id: "user-1" },
            error: null,
          }),
          update: vi.fn().mockReturnValue({
            eq: updateEq,
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    const response = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_BUSINESS",
      })
    );

    expect(response.status).toBe(200);
    expect(updateEq).toHaveBeenCalledWith("id", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    expect(mockLogAuditEvent).toHaveBeenCalled();
  });

  it("returns 404 when the owned item is not visible through the user-scoped client", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    const response = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_MARKET",
      })
    );

    expect(response.status).toBe(404);
  });
});

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
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { PATCH } from "./route";

const USER_ID = "00000000-0000-0000-0000-000000000111";
const BUSINESS_ID = "00000000-0000-0000-0000-000000000222";

function createRequest(body: unknown): NextRequest {
  return {
    method: "PATCH",
    json: async () => body,
  } as unknown as NextRequest;
}

describe("PATCH /api/businesses/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    });
  });

  it("persists business_details on update", async () => {
    const updateSpy = vi.fn().mockReturnThis();
    const eqSpy = vi.fn().mockReturnThis();

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "businesses") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: BUSINESS_ID, owner_id: USER_ID, status: "live" },
            }),
            update: updateSpy,
          };
        }
        if (table === "entitlements") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { tier: "growth" } }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    updateSpy.mockImplementation(() => ({
      eq: eqSpy,
    }));
    eqSpy.mockImplementation(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));

    const res = await PATCH(
      createRequest({
        business_name: "Mzansi Online",
        slug: "mzansi-online",
        business_type: "online_only",
        category: "electronics_tech",
        description: "Updated business profile",
        location_province: "Gauteng",
        location_city: "Johannesburg",
        business_details: {
          type: "online_only",
          primary_order_channel: "website",
          order_url: "https://orders.example.com",
          delivery_regions: ["Nationwide"],
          support_response_time: "Within 2 hours",
        },
      }),
      { params: Promise.resolve({ id: BUSINESS_ID }) }
    );

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        business_details: expect.objectContaining({
          type: "online_only",
          order_url: "https://orders.example.com",
        }),
      })
    );
  });
});

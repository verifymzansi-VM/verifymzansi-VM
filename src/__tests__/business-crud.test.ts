import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent, mockCheckRateLimit } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
    mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "@/app/api/businesses/route";

const USER_ID = "user-1";

const VALID_BODY = {
  business_name: "Nomsa Fashion",
  slug: "nomsa-fashion",
  business_type: "standalone_shop",
  category: "fashion_accessories",
  description: "A valid business profile description.",
  location_province: "Gauteng",
  location_city: "Johannesburg",
  gallery_photos: ["https://media.verifymzansi.co.za/business/photo-1.jpg"],
};

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

describe("POST /api/businesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    });
  });

  it("blocks a second free post when no paid plan exists", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "seller_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "seller-1" } }),
          };
        }
        if (table === "entitlements") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          };
        }
        if (table === "free_posts_used") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "used-1" } }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await POST(createRequest(VALID_BODY));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "Free post already used",
    });
  });

  it("blocks cover video uploads when the plan does not allow them", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "seller_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "seller-1" } }),
          };
        }
        if (table === "entitlements") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { tier: "starter" } }),
          };
        }
        if (table === "businesses") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockResolvedValue({ count: 0 }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await POST(
      createRequest({
        ...VALID_BODY,
        cover_video: "https://media.verifymzansi.co.za/business/cover-video.mp4",
      })
    );
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "Cover video is not available on your current plan.",
    });
  });
});

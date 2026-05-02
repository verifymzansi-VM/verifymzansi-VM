import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockLoggerError } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: mockLoggerError }),
}));

import { GET } from "./route";

describe("GET /api/promotions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ error: null }),
    });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "00000000-0000-0000-0000-000000000111",
            owner_id: "00000000-0000-0000-0000-000000000222",
            seller_id: "00000000-0000-0000-0000-000000000222",
            business_id: null,
            title: "Sample Event",
            description: "Sample event description",
            promotion_type: "event",
            category: null,
            category_key: "tourism_hospitality",
            photos: ["https://cdn.verifymzansi.co.za/media/photo.jpg"],
            videos: [],
            video_thumbnail: null,
            media_width: 1200,
            media_height: 675,
            focal_x: 0.5,
            focal_y: 0.5,
            price_cents: null,
            price_negotiable: false,
            location_province: "Gauteng",
            location_city: "Johannesburg",
            location_town: null,
            location_address: null,
            contact_methods: ["call"],
            start_date: null,
            end_date: null,
            event_details: {
              event_type: "festival_concert",
              venue_name: "Main Arena",
              parking_available: false,
            },
            boost_until: null,
            featured_until: null,
            status: "live",
            view_count: 0,
            published_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          error: null,
        }),
      })),
    });
  });

  it("returns event_details for live promotions", async () => {
    const response = await GET({} as NextRequest, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000111" }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      promotion?: { event_details?: { venue_name?: string; parking_available?: boolean } };
    };

    expect(payload.promotion?.event_details?.venue_name).toBe("Main Arena");
    expect(payload.promotion?.event_details?.parking_available).toBe(false);
  });

  it("returns 500 when the promotion query fails", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "column promotions.logo_url does not exist" },
        }),
      })),
    });

    const response = await GET({} as NextRequest, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000111" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch Tourism & Events post",
    });
    expect(mockLoggerError).toHaveBeenCalledWith("Failed to fetch promotion", {
      id: "00000000-0000-0000-0000-000000000111",
      error: "column promotions.logo_url does not exist",
    });
  });
});

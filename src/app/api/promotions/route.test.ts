import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { resetOwnerColumnCacheForTesting } from "@/lib/account/compat";

const { mockCreateAdminClient, mockCreateClient, mockCheckLocalRateLimit, mockGetClientIp } =
  vi.hoisted(() => ({
    mockCreateAdminClient: vi.fn(),
    mockCreateClient: vi.fn(),
    mockCheckLocalRateLimit: vi.fn(),
    mockGetClientIp: vi.fn(),
  }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
  checkRateLimit: vi.fn(),
  getClientIp: mockGetClientIp,
}));

import { GET } from "./route";

type PromotionsBuilderResult = {
  data: Array<Record<string, unknown>>;
  count: number;
  error: null | { message: string };
};

function buildPromotionsChain(result: PromotionsBuilderResult) {
  const chain = {
    eq: vi.fn(),
    gt: vi.fn(),
    lt: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue(result),
  } as {
    eq: ReturnType<typeof vi.fn>;
    gt: ReturnType<typeof vi.fn>;
    lt: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    or: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
  };

  chain.eq.mockReturnValue(chain);
  chain.gt.mockReturnValue(chain);
  chain.lt.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.or.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);

  return chain;
}

describe("GET /api/promotions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
  });

  it("returns 400 when event_type is invalid", async () => {
    const promotionsChain = buildPromotionsChain({
      data: [],
      count: 0,
      error: null,
    });

    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === "get_content_view_counts") {
          return Promise.resolve({ data: [], error: null });
        }
        if (fn === "get_content_like_summary") {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }),
      from: vi.fn((table: string) => {
        if (table === "promotions") {
          return {
            select: vi.fn(() => promotionsChain),
          };
        }

        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
            eq: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [], error: null }) })),
          })),
        };
      }),
    });

    const request = {
      nextUrl: new URL("https://example.com/api/promotions?event_type=not_real_type"),
      headers: new Headers(),
    } as NextRequest;

    const response = await GET(request);
    const payload = (await response.json()) as { error?: string; details?: Record<string, string> };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid promotions query");
    expect(payload.details).toBeDefined();
  });

  it("applies JSONB event_type filter when a valid event_type is provided", async () => {
    const promotionsChain = buildPromotionsChain({
      data: [
        {
          id: "00000000-0000-0000-0000-000000000111",
          owner_id: null,
          business_id: null,
          title: "Live Event",
          description: "Music and food",
          promotion_type: "event",
          category: null,
          category_key: "tourism_hospitality",
          photos: [],
          videos: [],
          video_thumbnail: null,
          media_width: 1200,
          media_height: 675,
          price_cents: null,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          contact_methods: ["call"],
          start_date: null,
          end_date: null,
          event_details: { event_type: "festival_concert" },
          boost_until: null,
          featured_until: null,
          view_count: 0,
          focal_x: 0.5,
          focal_y: 0.5,
          published_at: null,
          created_at: new Date().toISOString(),
        },
      ],
      count: 1,
      error: null,
    });

    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === "get_content_view_counts") {
          return Promise.resolve({
            data: [
              {
                target_id: "00000000-0000-0000-0000-000000000111",
                view_count: 0,
              },
            ],
            error: null,
          });
        }
        if (fn === "get_content_like_summary") {
          return Promise.resolve({
            data: [
              {
                target_id: "00000000-0000-0000-0000-000000000111",
                like_count: 0,
                viewer_has_liked: false,
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      }),
      from: vi.fn((table: string) => {
        if (table === "promotions") {
          return {
            select: vi.fn(() => promotionsChain),
          };
        }

        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
            eq: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [], error: null }) })),
          })),
        };
      }),
    });

    const request = {
      nextUrl: new URL("https://example.com/api/promotions?event_type=festival_concert"),
      headers: new Headers(),
    } as NextRequest;

    const response = await GET(request);
    const payload = (await response.json()) as {
      promotions?: Array<{ event_details?: { event_type?: string } }>;
    };

    expect(response.status).toBe(200);
    expect(promotionsChain.eq).toHaveBeenCalledWith(
      "event_details->>event_type",
      "festival_concert"
    );
    expect(payload.promotions?.[0]?.event_details?.event_type).toBe("festival_concert");
  });

  it("skips the not-yet-ended base filter when event_state=ended", async () => {
    const promotionsChain = buildPromotionsChain({ data: [], count: 0, error: null });

    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      from: vi.fn((table: string) => {
        if (table === "promotions") {
          return {
            select: vi.fn(() => promotionsChain),
          };
        }

        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
            eq: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [], error: null }) })),
          })),
        };
      }),
    });

    const request = {
      nextUrl: new URL("https://example.com/api/promotions?event_state=ended"),
      headers: new Headers(),
    } as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(promotionsChain.eq).toHaveBeenCalledWith("promotion_type", "event");
    expect(promotionsChain.lt).toHaveBeenCalledWith("end_date", expect.any(String));
    // The base "end_date is null or in the future" filter must not be ANDed in
    // — it would make the ended state return zero rows.
    expect(promotionsChain.or).not.toHaveBeenCalledWith(
      expect.stringContaining("end_date.is.null,end_date.gte.")
    );
  });

  it("applies the not-yet-ended base filter for upcoming events", async () => {
    const promotionsChain = buildPromotionsChain({ data: [], count: 0, error: null });

    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      from: vi.fn((table: string) => {
        if (table === "promotions") {
          return {
            select: vi.fn(() => promotionsChain),
          };
        }

        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
            eq: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [], error: null }) })),
          })),
        };
      }),
    });

    const request = {
      nextUrl: new URL("https://example.com/api/promotions?event_state=upcoming"),
      headers: new Headers(),
    } as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(promotionsChain.or).toHaveBeenCalledWith(
      expect.stringContaining("end_date.is.null,end_date.gte.")
    );
    expect(promotionsChain.gt).toHaveBeenCalledWith("start_date", expect.any(String));
  });

  it("returns 503 when owner-column probing fails", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue({
            error: { code: "XX000", message: "schema cache temporarily unavailable" },
          }),
        })),
      })),
    });

    const request = {
      nextUrl: new URL("https://example.com/api/promotions"),
      headers: new Headers(),
    } as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Marketplace temporarily unavailable",
    });
  });
});

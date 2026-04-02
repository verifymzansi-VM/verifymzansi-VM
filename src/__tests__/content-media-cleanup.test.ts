import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";
import { resetOwnerColumnCacheForTesting } from "@/lib/account/compat";

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
  checkLocalRateLimit: vi.fn().mockReturnValue({ limited: false }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/utils/api", () => ({
  parseJsonRequest: vi.fn(async (req: { json: () => Promise<unknown> }) => {
    try {
      return await req.json();
    } catch {
      return null;
    }
  }),
  parseAndValidateJsonRequest: vi.fn(
    async (
      req: { json: () => Promise<unknown> },
      schema: {
        safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: unknown };
      }
    ) => {
      try {
        const body = await req.json();
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          return {
            success: false as const,
            response: NextResponse.json({ error: "Validation failed" }, { status: 400 }),
          };
        }

        return {
          success: true as const,
          data: parsed.data,
        };
      } catch {
        return {
          success: false as const,
          response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
        };
      }
    }
  ),
  parseAndValidateRouteParams: vi.fn(
    (
      params: unknown,
      schema: {
        safeParse: (value: unknown) => { success: boolean; data?: unknown };
      }
    ) => {
      const parsed = schema.safeParse(params);
      if (!parsed.success) {
        return {
          success: false as const,
          response: NextResponse.json({ error: "Invalid route params" }, { status: 400 }),
        };
      }

      return {
        success: true as const,
        data: parsed.data,
      };
    }
  ),
}));

import { PUT as updateListing } from "@/app/api/listings/[id]/route";
import { PATCH as updateBusiness, DELETE as deleteBusiness } from "@/app/api/businesses/[id]/route";
import { PUT as updatePromotion } from "@/app/api/promotions/[id]/route";

const USER_ID = "user-1";
const VALID_UUID = "00000000-0000-0000-0000-000000000001";

function createRequest(url: string, method: string, body?: unknown): NextRequest {
  return {
    method,
    json: async () => body,
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL(url, "http://localhost:3000"),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOwnerColumnCacheForTesting();
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID, email: "seller@example.com" } },
      }),
    },
  });
  mockCheckRateLimit.mockResolvedValue({ limited: false });
});

function createAuthenticatedClient(from?: (table: string) => unknown) {
  return {
    ...(from ? { from: vi.fn(from) } : {}),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID, email: "seller@example.com" } },
      }),
    },
  };
}

function createOwnerColumnSelect(base: Record<string, unknown>) {
  return vi.fn((fields?: string) => {
    if (fields === "id, owner_id") {
      return {
        limit: vi.fn().mockResolvedValue({ error: null }),
      };
    }

    return base;
  });
}

describe("content media cleanup queueing", () => {
  it("returns 404 when the user does not own the business being updated", async () => {
    mockCreateClient.mockResolvedValue(
      createAuthenticatedClient((table: string) => {
        if (table === "businesses") {
          const builder = {
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          };
          return {
            ...builder,
            select: createOwnerColumnSelect(builder),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      })
    );

    const res = await updateBusiness(
      createRequest(`http://localhost:3000/api/businesses/${VALID_UUID}`, "PATCH", {
        business_type: "standalone_shop",
        business_name: "Nomsa Fashion",
        slug: "nomsa-fashion",
        description: "A valid business profile description that is long enough for validation.",
        category: "fashion_accessories",
        location_province: "Gauteng",
        location_city: "Johannesburg",
        services_offered: ["Custom tailoring"],
        operating_hours: {},
        payment_methods_accepted: [],
        delivery_options: [],
      }),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when the user does not own the business being deleted", async () => {
    mockCreateClient.mockResolvedValue(
      createAuthenticatedClient((table: string) => {
        if (table === "businesses") {
          const builder = {
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          };
          return {
            ...builder,
            select: createOwnerColumnSelect(builder),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      })
    );

    const res = await deleteBusiness(
      createRequest(`http://localhost:3000/api/businesses/${VALID_UUID}`, "DELETE"),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );

    expect(res.status).toBe(404);
  });

  it("queues removed listing media after a successful update", async () => {
    const queueInsert = vi.fn().mockResolvedValue({ error: null });
    const clientFrom = (table: string) => {
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
      if (table === "listings") {
        const updateChain: Record<string, ReturnType<typeof vi.fn>> = {
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({ data: [{ id: VALID_UUID }], error: null }),
        };
        (updateChain.eq as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);
        const builder = {
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: VALID_UUID,
              owner_id: USER_ID,
              status: "live",
              area: "MZANSI_MARKET",
              photos: ["https://media.verifymzansi.com/listings/old-photo.jpg"],
              videos: ["https://media.verifymzansi.com/listings/old-video.mp4"],
              video_thumbnail: "https://media.verifymzansi.com/listings/old-thumb.jpg",
              logo_url: "https://media.verifymzansi.com/listings/old-logo.jpg",
              updated_at: "2026-01-01T00:00:00Z",
            },
          }),
          update: vi.fn().mockReturnValue(updateChain),
        };
        return {
          ...builder,
          select: createOwnerColumnSelect(builder),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      };
    };

    mockCreateClient.mockResolvedValue(createAuthenticatedClient(clientFrom));
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "r2_cleanup_queue") {
          return { insert: queueInsert };
        }
        if (table === "businesses") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await updateListing(
      createRequest(`http://localhost:3000/api/listings/${VALID_UUID}`, "PUT", {
        title: "Updated iPhone 15 Pro",
        description: "A valid updated listing description that is comfortably long enough.",
        price_zar: 12000,
        negotiable: false,
        province: "Gauteng",
        city: "Johannesburg",
        category: "electronics",
        attributes: { device_type: "Smartphone", brand: "Apple" },
        images: ["https://media.verifymzansi.com/listings/new-photo.jpg"],
        videos: [],
      }),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );

    expect(res.status).toBe(200);
    expect(queueInsert).toHaveBeenCalledWith([
      {
        bucket: "public",
        r2_key: "listings/old-photo.jpg",
        reason: "listing_media_replaced",
      },
      {
        bucket: "public",
        r2_key: "listings/old-video.mp4",
        reason: "listing_media_replaced",
      },
      {
        bucket: "public",
        r2_key: "listings/old-thumb.jpg",
        reason: "listing_media_replaced",
      },
      {
        bucket: "public",
        r2_key: "listings/old-logo.jpg",
        reason: "listing_media_replaced",
      },
    ]);
  });

  it("queues removed promotion media after a successful update", async () => {
    const queueInsert = vi.fn().mockResolvedValue({ error: null });
    const clientFrom = (table: string) => {
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
      if (table === "promotions") {
        const builder = {
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: VALID_UUID,
              owner_id: USER_ID,
              status: "live",
              photos: ["https://media.verifymzansi.com/promotions/old-photo.jpg"],
              videos: ["https://media.verifymzansi.com/promotions/old-video.mp4"],
              video_thumbnail: "https://media.verifymzansi.com/promotions/old-thumb.jpg",
            },
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
        return {
          ...builder,
          select: createOwnerColumnSelect(builder),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      };
    };

    mockCreateClient.mockResolvedValue(createAuthenticatedClient(clientFrom));
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "r2_cleanup_queue") {
          return { insert: queueInsert };
        }
        if (table === "businesses") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await updatePromotion(
      createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, "PUT", {
        title: "Weekend Promo",
        description: "A valid promotion description that is long enough to pass validation.",
        promotion_type: "deal",
        province: "Gauteng",
        city: "Johannesburg",
        contact_methods: ["call"],
        images: ["https://media.verifymzansi.com/promotions/new-photo.jpg"],
        videos: [],
      }),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );

    expect(await res.json()).toEqual({ success: true });
    expect(queueInsert).toHaveBeenCalledWith([
      {
        bucket: "public",
        r2_key: "promotions/old-photo.jpg",
        reason: "promotion_media_replaced",
      },
      {
        bucket: "public",
        r2_key: "promotions/old-video.mp4",
        reason: "promotion_media_replaced",
      },
      {
        bucket: "public",
        r2_key: "promotions/old-thumb.jpg",
        reason: "promotion_media_replaced",
      },
    ]);
  });

  it("queues deleted business media after a successful delete", async () => {
    const queueInsert = vi.fn().mockResolvedValue({ error: null });
    mockCreateClient.mockResolvedValue(
      createAuthenticatedClient((table: string) => {
        if (table === "businesses") {
          const builder = {
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: VALID_UUID,
                owner_id: USER_ID,
                status: "draft",
                logo_url: "https://media.verifymzansi.com/business/logo.jpg",
                cover_photo: "https://media.verifymzansi.com/business/cover.jpg",
                cover_video: "https://media.verifymzansi.com/business/cover.mp4",
                video_thumbnail: "https://media.verifymzansi.com/business/thumb.jpg",
                gallery_photos: ["https://media.verifymzansi.com/business/gallery-1.jpg"],
              },
            }),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          };
          return {
            ...builder,
            select: createOwnerColumnSelect(builder),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      })
    );
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "r2_cleanup_queue") {
          return { insert: queueInsert };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await deleteBusiness(
      createRequest(`http://localhost:3000/api/businesses/${VALID_UUID}`, "DELETE"),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );

    expect(await res.json()).toEqual({ success: true });
    expect(queueInsert).toHaveBeenCalledWith([
      {
        bucket: "public",
        r2_key: "business/logo.jpg",
        reason: "business_deleted",
      },
      {
        bucket: "public",
        r2_key: "business/cover.jpg",
        reason: "business_deleted",
      },
      {
        bucket: "public",
        r2_key: "business/cover.mp4",
        reason: "business_deleted",
      },
      {
        bucket: "public",
        r2_key: "business/thumb.jpg",
        reason: "business_deleted",
      },
      {
        bucket: "public",
        r2_key: "business/gallery-1.jpg",
        reason: "business_deleted",
      },
    ]);
  });

  it("queues removed business media after a successful update", async () => {
    const queueInsert = vi.fn().mockResolvedValue({ error: null });
    mockCreateClient.mockResolvedValue(
      createAuthenticatedClient((table: string) => {
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
        if (table === "businesses") {
          const updateResult = Promise.resolve({ error: null }) as Promise<{
            error: null;
          }> & {
            eq: ReturnType<typeof vi.fn>;
          };
          updateResult.eq = vi.fn().mockImplementation(() => updateResult);
          const builder = {
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: VALID_UUID,
                owner_id: USER_ID,
                status: "live",
                logo_url: null,
                cover_photo: "https://media.verifymzansi.com/business/old-cover.jpg",
                cover_video: null,
                video_thumbnail: null,
                gallery_photos: ["https://media.verifymzansi.com/business/old-gallery.jpg"],
              },
            }),
            update: vi.fn().mockReturnValue(updateResult),
          };
          return {
            ...builder,
            select: createOwnerColumnSelect(builder),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      })
    );
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "r2_cleanup_queue") {
          return { insert: queueInsert };
        }
        if (table === "businesses") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await updateBusiness(
      createRequest(`http://localhost:3000/api/businesses/${VALID_UUID}`, "PATCH", {
        business_name: "Nomsa Fashion",
        slug: "nomsa-fashion",
        business_type: "standalone_shop",
        category: "fashion_accessories",
        description: "A valid business profile description that meets the schema length.",
        location_province: "Gauteng",
        location_city: "Johannesburg",
        business_details: {
          type: "standalone_shop",
          street_address: "24 Vilakazi Street",
          suburb: "Orlando West",
          walk_in_policy: "walk_ins_welcome",
        },
        gallery_photos: ["https://media.verifymzansi.com/business/new-gallery.jpg"],
        cover_photo: "https://media.verifymzansi.com/business/new-cover.jpg",
      }),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );

    expect(await res.json()).toEqual({ success: true });
    expect(queueInsert).toHaveBeenCalledWith([
      {
        bucket: "public",
        r2_key: "business/old-cover.jpg",
        reason: "business_media_replaced",
      },
      {
        bucket: "public",
        r2_key: "business/old-gallery.jpg",
        reason: "business_media_replaced",
      },
    ]);
  });
});

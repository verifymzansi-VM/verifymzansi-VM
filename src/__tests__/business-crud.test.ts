import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
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
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET, POST } from "@/app/api/businesses/route";
import { GET as GET_DETAIL } from "@/app/api/businesses/[id]/route";

const USER_ID = "user-1";
const VALID_BUSINESS_ID = "00000000-0000-0000-0000-000000000002";

const VALID_BODY = {
  business_name: "Nomsa Fashion",
  slug: "nomsa-fashion",
  business_type: "standalone_shop",
  category: "fashion_accessories",
  description: "A valid business profile description.",
  location_province: "Gauteng",
  location_city: "Johannesburg",
  business_details: {
    type: "standalone_shop",
    street_address: "24 Vilakazi Street",
    suburb: "Orlando West",
    walk_in_policy: "walk_ins_welcome",
  },
  gallery_photos: ["https://media.verifymzansi.com/business/photo-1.jpg"],
};

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    url: "https://verifymzansi.com/api/businesses",
    nextUrl: new URL("https://verifymzansi.com/api/businesses"),
    headers: new Headers(),
  } as unknown as NextRequest;
}

function createCrossSiteRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    url: "https://verifymzansi.com/api/businesses",
    nextUrl: new URL("https://verifymzansi.com/api/businesses"),
    headers: new Headers({ origin: "https://evil.example" }),
  } as unknown as NextRequest;
}

describe("POST /api/businesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
    mockCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        const adminClient = mockCreateAdminClient();
        if (adminClient && typeof adminClient.from === "function") {
          return adminClient.from(table);
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          insert: vi.fn().mockResolvedValue({ error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    });
  });

  it("blocks a second free post when no paid plan exists", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
              },
            }),
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
            insert: vi.fn().mockResolvedValue({
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            }),
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

  it("rejects cross-site business creation requests", async () => {
    const res = await POST(createCrossSiteRequest(VALID_BODY));

    expect(res.status).toBe(403);
  });

  it("blocks cover video uploads when the plan does not allow them", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
              },
            }),
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
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "business-2" } }),
            neq: vi.fn().mockReturnThis(),
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
        cover_video: "https://media.verifymzansi.com/business/cover-video.mp4",
      })
    );
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "Cover video is not available on your current plan.",
    });
  });

  it("returns 409 when the requested slug is already in use", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
              },
            }),
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

        if (table === "businesses") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
              },
            }),
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
        if (table === "businesses") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "business-2" } }),
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

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "Business slug already in use",
      details: { slug: "This URL slug is already taken." },
    });
  });

  it("returns 409 when the database unique index rejects a racing duplicate slug", async () => {
    const freePostCleanup = vi.fn().mockResolvedValue({ error: null });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
              },
            }),
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
        if (table === "businesses") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          };
        }
        if (table === "free_posts_used") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: freePostCleanup,
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from: vi.fn((table: string) => {
        const adminClient = mockCreateAdminClient();
        if (table === "businesses") {
          return {
            select: vi.fn((fields: string) => {
              if (fields === "id, owner_id") {
                return { limit: vi.fn().mockResolvedValue({ error: null }) };
              }

              return {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null }),
              };
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: {
                    code: "23505",
                    message:
                      'duplicate key value violates unique constraint "idx_businesses_slug_unique"',
                    constraint: "idx_businesses_slug_unique",
                  },
                }),
              }),
            }),
          };
        }

        if (adminClient && typeof adminClient.from === "function") {
          return adminClient.from(table);
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await POST(createRequest(VALID_BODY));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "Business slug already in use",
      details: { slug: "This URL slug is already taken." },
    });
    expect(freePostCleanup).toHaveBeenCalled();
  });

  it("does not claim a free post before validation passes", async () => {
    const freePostInsert = vi.fn().mockResolvedValue({ error: null });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
              },
            }),
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
            insert: freePostInsert,
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
        cover_video: "https://media.verifymzansi.com/business/cover-video.mp4",
      })
    );

    expect(res.status).toBe(422);
    expect(freePostInsert).not.toHaveBeenCalled();
  });

  it("persists business_details on successful create", async () => {
    const insertSpy = vi.fn().mockReturnThis();
    const selectSpy = vi.fn().mockReturnThis();
    const singleSpy = vi.fn().mockResolvedValue({ data: { id: "business-1" }, error: null });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
              },
            }),
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
        if (table === "businesses") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            neq: vi.fn().mockReturnThis(),
            insert: insertSpy,
            single: singleSpy,
          };
        }
        return {
          select: selectSpy,
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    insertSpy.mockImplementation(() => ({
      select: () => ({
        single: singleSpy,
      }),
    }));

    const res = await POST(createRequest(VALID_BODY));

    expect(res.status).toBe(201);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        business_details: expect.objectContaining({
          type: "standalone_shop",
          street_address: "24 Vilakazi Street",
          suburb: "Orlando West",
        }),
      })
    );
  });

  it("rejects business media hosted outside the platform", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
              },
            }),
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
        logo_url: "https://evil.example.com/logo.png",
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Validation failed",
    });
  });

  it("returns verification_required for unverified accounts", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "rejected",
              },
            }),
          };
        }
        if (table === "verification_steps") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [] }),
            }),
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
      error: "Verification required",
      code: "verification_required",
    });
  });

  it("allows business creation when the profile is stale but all verification steps are approved", async () => {
    const insertSpy = vi.fn().mockReturnValue({
      select: () => ({
        single: vi.fn().mockResolvedValue({ data: { id: "business-1" }, error: null }),
      }),
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "incomplete",
              },
            }),
          };
        }
        if (table === "verification_steps") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { step_type: "phone", status: "approved" },
                  { step_type: "id_doc", status: "approved" },
                  { step_type: "selfie", status: "approved" },
                  { step_type: "location", status: "approved" },
                ],
              }),
            }),
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
        if (table === "businesses") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            neq: vi.fn().mockReturnThis(),
            insert: insertSpy,
            single: vi.fn().mockResolvedValue({ data: { id: "business-1" }, error: null }),
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

    expect(res.status).toBe(201);
    expect(insertSpy).toHaveBeenCalled();
  });

  it("writes seller_id when businesses still use the legacy owner column", async () => {
    const insertSpy = vi.fn().mockReturnValue({
      select: () => ({
        single: vi.fn().mockResolvedValue({ data: { id: "business-1" }, error: null }),
      }),
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
              },
            }),
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
            insert: vi.fn().mockResolvedValue({ error: null }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        if (table === "businesses") {
          return {
            select: vi.fn((fields: string) => {
              if (fields === "id, owner_id") {
                return {
                  limit: vi.fn().mockResolvedValue({
                    error: {
                      code: "42703",
                      message: "column businesses.owner_id does not exist",
                    },
                  }),
                };
              }
              if (fields === "id, seller_id") {
                return {
                  limit: vi.fn().mockResolvedValue({ error: null }),
                };
              }
              if (fields === "id") {
                return {
                  eq: vi.fn().mockReturnThis(),
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                };
              }
              return {
                neq: vi.fn().mockResolvedValue({ count: 0 }),
              };
            }),
            insert: insertSpy,
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

    expect(res.status).toBe(201);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        seller_id: USER_ID,
      })
    );
    expect(insertSpy).not.toHaveBeenCalledWith(expect.objectContaining({ owner_id: USER_ID }));
  });
});

describe("GET /api/businesses/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

  afterEach(() => {
    mockCreateClient.mockReset();
    mockCreateAdminClient.mockReset();
  });

  it("returns 404 for missing business", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [] }),
      }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    });

    const request = {
      nextUrl: new URL(`http://localhost:3000/api/businesses/${USER_ID}`),
      url: `http://localhost:3000/api/businesses/${USER_ID}`,
      method: "GET",
      headers: new Headers(),
    } as NextRequest;

    const response = await GET_DETAIL(request, {
      params: Promise.resolve({ id: VALID_BUSINESS_ID }),
    });

    expect(response.status).toBe(404);
  });

  it("returns live business publicly and redacts direct contact fields for anonymous viewers", async () => {
    const from = vi.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: VALID_BUSINESS_ID,
              status: "live",
              owner_id: USER_ID,
              business_name: "Nomsa Fashion",
              phone: "+27110000000",
              whatsapp: "+27110000000",
              email: "owner@example.com",
            },
            error: null,
          }),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [] }),
        };
      }

      if (table === "promotions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [] }),
        };
      }

      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    });

    const request = {
      nextUrl: new URL(`http://localhost:3000/api/businesses/${VALID_BUSINESS_ID}`),
      url: `http://localhost:3000/api/businesses/${VALID_BUSINESS_ID}`,
      method: "GET",
      headers: new Headers(),
    } as NextRequest;

    const response = await GET_DETAIL(request, {
      params: Promise.resolve({ id: VALID_BUSINESS_ID }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.business.id).toBe(VALID_BUSINESS_ID);
    expect(json.business.phone).toBeUndefined();
    expect(json.business.whatsapp).toBeUndefined();
    expect(json.business.email).toBeUndefined();
  });

  it("returns 404 for non-live businesses when the viewer is not the owner", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "businesses") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: VALID_BUSINESS_ID, status: "draft", owner_id: "owner-2" },
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    });

    const request = {
      nextUrl: new URL(`http://localhost:3000/api/businesses/${VALID_BUSINESS_ID}`),
      url: `http://localhost:3000/api/businesses/${VALID_BUSINESS_ID}`,
      method: "GET",
      headers: new Headers(),
    } as NextRequest;

    const response = await GET_DETAIL(request, {
      params: Promise.resolve({ id: VALID_BUSINESS_ID }),
    });

    expect(response.status).toBe(404);
  });
});

describe("GET /api/businesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

  it("uses the user-scoped client for mine mode", async () => {
    const orderSpy = vi.fn().mockReturnThis();
    const limitSpy = vi.fn().mockReturnThis();
    const eqSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: "business-owned-1",
          business_name: "Nomsa Fashion",
          business_type: "standalone_shop",
          category: "fashion_accessories",
          status: "pending_moderation",
          created_at: "2026-03-19T08:00:00.000Z",
        },
      ],
    });

    mockCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "businesses") {
          return {
            select: vi.fn((fields: string) => {
              if (fields === "id, owner_id") {
                return {
                  limit: vi.fn().mockResolvedValue({ error: null }),
                };
              }

              return {
                order: orderSpy,
                limit: limitSpy,
                eq: eqSpy,
              };
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    });

    const request = {
      nextUrl: new URL("http://localhost:3000/api/businesses?mine=true&limit=10"),
    } as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      businesses: [
        expect.objectContaining({
          id: "business-owned-1",
          business_name: "Nomsa Fashion",
        }),
      ],
    });
    expect(eqSpy).toHaveBeenCalledWith("owner_id", USER_ID);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("requires authentication for mine mode", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    });

    const request = {
      nextUrl: new URL("http://localhost:3000/api/businesses?mine=true"),
    } as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("applies placeholder-content exclusions to public business queries", async () => {
    const rangeSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: "business-seed",
          owner_id: USER_ID,
          business_name: "Seed Demo Shop",
          description: "Sample marketplace placeholder",
        },
        {
          id: "business-real",
          owner_id: USER_ID,
          business_name: "Nomsa Fashion",
          description: "A valid business profile description.",
        },
      ],
      count: 2,
      error: null,
    });
    const orderSpy = vi.fn().mockReturnThis();
    const eqSpy = vi.fn().mockReturnThis();
    const selectSpy = vi.fn().mockReturnThis();
    const fromSpy = vi.fn().mockReturnValue({
      select: selectSpy,
      eq: eqSpy,
      order: orderSpy,
      range: rangeSpy,
    });

    mockCreateAdminClient.mockReturnValue({
      from: fromSpy,
    });

    const request = {
      nextUrl: new URL("http://localhost:3000/api/businesses?page=1&limit=24"),
    } as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.businesses).toHaveLength(1);
    expect(json.businesses[0]).toMatchObject({
      id: "business-real",
      business_name: "Nomsa Fashion",
    });
    expect(json.total).toBe(1);
  });

  it("redacts direct contact fields from public business list responses", async () => {
    const rangeSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: "business-real",
          owner_id: USER_ID,
          business_name: "Nomsa Fashion",
          description: "A valid business profile description.",
          phone: "+27110000000",
          whatsapp: "+27110000000",
          email: "owner@example.com",
        },
      ],
      count: 1,
      error: null,
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "businesses") {
          return {
            select: vi.fn((fields: string) => {
              if (fields === "id, owner_id") {
                return {
                  limit: vi.fn().mockResolvedValue({ error: null }),
                };
              }

              return {
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                range: rangeSpy,
              };
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const request = {
      nextUrl: new URL("http://localhost:3000/api/businesses?page=1&limit=24"),
    } as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.businesses[0].phone).toBeUndefined();
    expect(json.businesses[0].whatsapp).toBeUndefined();
    expect(json.businesses[0].email).toBeUndefined();
  });

  it("falls back to seller_id and normalizes business responses back to owner_id", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "businesses") {
          return {
            select: vi.fn((fields: string) => {
              if (fields === "id, owner_id") {
                return {
                  limit: vi.fn().mockResolvedValue({
                    error: {
                      code: "42703",
                      message: "column businesses.owner_id does not exist",
                    },
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
                not: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                range: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "business-1",
                      seller_id: USER_ID,
                      business_name: "Nomsa Fashion",
                      description: "A valid business profile description.",
                    },
                  ],
                  count: 1,
                  error: null,
                }),
              };
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const request = {
      nextUrl: new URL("http://localhost:3000/api/businesses?page=1&limit=24"),
    } as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.businesses[0]).toMatchObject({
      id: "business-1",
      owner_id: USER_ID,
      seller_id: USER_ID,
    });
  });

  it.each([
    {
      missingField: "gallery_photos",
      expectedNullField: "gallery_photos",
      initialSelect:
        "id, owner_id, business_type, business_name, slug, description, category, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, business_details, boost_until, featured_until, published_at, created_at",
      fallbackSelect:
        "id, owner_id, business_type, business_name, slug, description, category, logo_url, cover_photo, cover_video, video_thumbnail, location_province, location_city, store_number, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, business_details, boost_until, featured_until, published_at, created_at",
    },
    {
      missingField: "business_details",
      expectedNullField: "business_details",
      initialSelect:
        "id, owner_id, business_type, business_name, slug, description, category, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, business_details, boost_until, featured_until, published_at, created_at",
      fallbackSelect:
        "id, owner_id, business_type, business_name, slug, description, category, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, boost_until, featured_until, published_at, created_at",
    },
  ])(
    "returns 200 and normalizes %s when the column is missing",
    async ({ missingField, expectedNullField, initialSelect, fallbackSelect }) => {
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === "businesses") {
            return {
              select: vi.fn((fields: string) => {
                if (fields === "id, owner_id") {
                  return {
                    limit: vi.fn().mockResolvedValue({ error: null }),
                  };
                }

                if (fields === initialSelect) {
                  return {
                    eq: vi.fn().mockReturnThis(),
                    not: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    range: vi.fn().mockResolvedValue({
                      data: null,
                      count: null,
                      error: {
                        code: "42703",
                        message: `column businesses.${missingField} does not exist`,
                      },
                    }),
                  };
                }

                if (fields === fallbackSelect || !fields.includes(missingField)) {
                  return {
                    eq: vi.fn().mockReturnThis(),
                    not: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    range: vi.fn().mockResolvedValue({
                      data: null,
                      count: null,
                      error: {
                        code: "42703",
                        message: `column businesses.${missingField} does not exist`,
                      },
                    }),
                  };
                }

                if (fields.includes(missingField)) {
                  return {
                    eq: vi.fn().mockReturnThis(),
                    not: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    range: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: "business-1",
                          owner_id: USER_ID,
                          business_name: "Nomsa Fashion",
                          description: "A valid business profile description.",
                          business_type: "standalone_shop",
                          category: "fashion_accessories",
                          location_province: "Gauteng",
                          location_city: "Johannesburg",
                        },
                      ],
                      count: 1,
                      error: null,
                    }),
                  };
                }

                throw new Error(`Unexpected select clause: ${fields}`);
              }),
            };
          }

          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          };
        }),
      });

      const request = {
        nextUrl: new URL("http://localhost:3000/api/businesses?page=1&limit=24"),
      } as NextRequest;

      const response = await GET(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.businesses[0]).toMatchObject({
        id: "business-1",
        owner_id: USER_ID,
        [expectedNullField]: null,
      });
    }
  );
});

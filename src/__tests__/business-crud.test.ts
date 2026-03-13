import { beforeEach, describe, expect, it, vi } from "vitest";
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

const USER_ID = "user-1";

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
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

describe("POST /api/businesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
    mockCreateClient.mockResolvedValue({
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
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
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

describe("GET /api/businesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

  it("applies placeholder-content exclusions to public business queries", async () => {
    const rangeSpy = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
    const orderSpy = vi.fn().mockReturnThis();
    const notSpy = vi.fn().mockReturnThis();
    const eqSpy = vi.fn().mockReturnThis();
    const selectSpy = vi.fn().mockReturnThis();
    const fromSpy = vi.fn().mockReturnValue({
      select: selectSpy,
      eq: eqSpy,
      not: notSpy,
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
    expect(notSpy).toHaveBeenCalledWith("business_name", "ilike", "%seed%");
    expect(notSpy).toHaveBeenCalledWith("business_name", "ilike", "%[seed]%");
    expect(notSpy).toHaveBeenCalledWith("business_name", "ilike", "%demo%");
    expect(notSpy).toHaveBeenCalledWith("business_name", "ilike", "%sample%");
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
        "id, owner_id, business_type, business_name, slug, description, category, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, phone, whatsapp, email, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, business_details, boost_until, featured_until, published_at, created_at",
      fallbackSelect:
        "id, owner_id, business_type, business_name, slug, description, category, logo_url, cover_photo, cover_video, video_thumbnail, location_province, location_city, store_number, phone, whatsapp, email, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, business_details, boost_until, featured_until, published_at, created_at",
    },
    {
      missingField: "business_details",
      expectedNullField: "business_details",
      initialSelect:
        "id, owner_id, business_type, business_name, slug, description, category, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, phone, whatsapp, email, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, business_details, boost_until, featured_until, published_at, created_at",
      fallbackSelect:
        "id, owner_id, business_type, business_name, slug, description, category, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, phone, whatsapp, email, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, boost_until, featured_until, published_at, created_at",
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

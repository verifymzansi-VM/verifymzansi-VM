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

const { mockEnforceCsrfToken } = vi.hoisted(() => ({
  mockEnforceCsrfToken: vi.fn(),
}));

const { mockHasPhoneNumber } = vi.hoisted(() => ({
  mockHasPhoneNumber: vi.fn(),
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
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: mockEnforceCsrfToken }));
vi.mock("@/lib/account/require-phone", () => ({ hasPhoneNumber: mockHasPhoneNumber }));

import { GET, POST } from "@/app/api/listings/route";

const USER_ID = "user-1";
const VALID_IMAGE = "https://media.verifymzansi.com/image.jpg";
const VALID_VIDEO = "https://media.verifymzansi.com/video.mp4";

const VALID_BODY = {
  title: "Apple iPhone 15 Pro",
  description: "A valid listing description that is long enough for the schema to accept it.",
  price_zar: 12000,
  negotiable: false,
  province: "Gauteng",
  city: "Johannesburg",
  category: "electronics",
  attributes: { device_type: "Smartphone", brand: "Apple" },
  images: [VALID_IMAGE],
};

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    text: async () => JSON.stringify(body),
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

function createGetRequest(url: string): NextRequest {
  return {
    method: "GET",
    nextUrl: new URL(url),
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

describe("POST /api/listings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
    mockEnforceCsrfToken.mockReturnValue(null);
    mockHasPhoneNumber.mockResolvedValue(true);
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

  it("rejects requests missing a CSRF token", async () => {
    mockEnforceCsrfToken.mockReturnValue(
      Response.json({ error: "Invalid CSRF token" }, { status: 403 })
    );

    const res = await POST(createRequest(VALID_BODY));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid CSRF token" });
  });

  it("returns 503 when owner-column probing fails during create", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "listings") {
          return {
            select: vi.fn((fields: string) => {
              if (fields === "id, owner_id") {
                return {
                  limit: vi.fn().mockResolvedValue({
                    error: { code: "XX000", message: "schema cache temporarily unavailable" },
                  }),
                };
              }
              return {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    });

    const res = await POST(createRequest(VALID_BODY));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: "Service temporarily unavailable",
    });
  });

  it("rejects video uploads when the paid plan disallows them", async () => {
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
            maybeSingle: vi.fn().mockResolvedValue({ data: { tier: "basic" } }),
          };
        }
        if (table === "listings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
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

    const res = await POST(createRequest({ ...VALID_BODY, videos: [VALID_VIDEO] }));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "Video upload is not available on your current plan.",
    });
  });

  it("rejects when api callers exceed the plan video count", async () => {
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
        if (table === "listings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
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

    const res = await POST(
      createRequest({ ...VALID_BODY, videos: [VALID_VIDEO, `${VALID_VIDEO}?2`] })
    );
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "Maximum 1 videos allowed on your plan",
    });
  });

  it("rejects listing media hosted outside the platform", async () => {
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
        images: ["https://evil.example.com/not-allowed.jpg"],
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "Validation failed",
    });
  });

  it("rejects listing logos hosted outside the platform", async () => {
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
        logo_url: "https://evil.example.com/not-allowed-logo.jpg",
      })
    );

    expect(res.status).toBe(422);
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
                account_verification_status: "incomplete",
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

  it("allows listing creation when the profile is stale but all verification steps are approved", async () => {
    const insertSpy = vi.fn().mockReturnValue({
      select: () => ({
        single: vi.fn().mockResolvedValue({ data: { id: "listing-1" }, error: null }),
      }),
    });

    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: true }),
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
            maybeSingle: vi.fn().mockResolvedValue({ data: { tier: "basic" } }),
          };
        }
        if (table === "listings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
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
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(insertSpy).toHaveBeenCalled();
    expect(body).toMatchObject({
      id: "listing-1",
      message: "Listing submitted for review",
      status: "pending_moderation",
    });
  });

  it("writes seller_id when listings still use the legacy owner column", async () => {
    const insertSpy = vi.fn().mockReturnValue({
      select: () => ({
        single: vi.fn().mockResolvedValue({ data: { id: "listing-1" }, error: null }),
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
        if (table === "listings") {
          return {
            select: vi.fn((fields: string) => {
              if (fields === "id, owner_id") {
                return {
                  limit: vi.fn().mockResolvedValue({
                    error: { code: "42703", message: "column listings.owner_id does not exist" },
                  }),
                };
              }
              if (fields === "id, seller_id") {
                return {
                  limit: vi.fn().mockResolvedValue({ error: null }),
                };
              }
              const chain: Record<string, ReturnType<typeof vi.fn>> = {
                eq: vi.fn(),
                gte: vi.fn(),
                neq: vi.fn(),
                limit: vi.fn(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null }),
              };
              chain.eq.mockReturnValue(chain);
              chain.gte.mockReturnValue(chain);
              chain.neq.mockReturnValue(chain);
              chain.limit.mockReturnValue(chain);
              return chain;
            }),
            update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
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

  it("persists trusted listing logo urls on create", async () => {
    const insertSpy = vi.fn().mockReturnValue({
      select: () => ({
        single: vi.fn().mockResolvedValue({ data: { id: "listing-1" }, error: null }),
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
        if (table === "listings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
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

    const res = await POST(
      createRequest({
        ...VALID_BODY,
        logo_url: "https://media.verifymzansi.com/listings/logo.jpg",
      })
    );

    expect(res.status).toBe(201);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logo_url: "https://media.verifymzansi.com/listings/logo.jpg",
      })
    );
  });

  it("does not consume free post slot when media validation fails (regression)", async () => {
    const freePostInsertSpy = vi.fn().mockResolvedValue({ error: null });

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
            insert: freePostInsertSpy,
          };
        }
        if (table === "listings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
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

    // Submit with too many images to trigger 422 from media validation
    const tooManyImages = Array.from(
      { length: 11 },
      (_, i) => `https://media.verifymzansi.com/img${i}.jpg`
    );
    const res = await POST(createRequest({ ...VALID_BODY, images: tooManyImages }));

    expect(res.status).toBe(422);
    // free_posts_used.insert must NOT have been called — validation fires before claim
    expect(freePostInsertSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/listings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

  it("applies placeholder-content exclusions to public listing queries", async () => {
    const rangeSpy = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
    const orderSpy = vi.fn().mockReturnThis();
    const eqSpy = vi.fn().mockReturnThis();
    const selectSpy = vi.fn().mockReturnThis();
    const fromSpy = vi.fn().mockReturnValue({
      select: selectSpy,
      eq: eqSpy,
      neq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: orderSpy,
      range: rangeSpy,
    });

    mockCreateAdminClient.mockReturnValue({
      from: fromSpy,
    });

    const response = await GET(
      createGetRequest("http://localhost:3000/api/listings?page=1&limit=24")
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.listings).toEqual([]);
    expect(json.total).toBe(0);
  });

  it("returns 503 when owner-column probing fails for public listing discovery", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "listings") {
          return {
            select: vi.fn((fields: string) => {
              if (fields === "id, owner_id") {
                return {
                  limit: vi.fn().mockResolvedValue({
                    error: { code: "XX000", message: "schema cache temporarily unavailable" },
                  }),
                };
              }
              return {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                not: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
              };
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [] }) }),
        };
      }),
    });

    const response = await GET(
      createGetRequest("http://localhost:3000/api/listings?page=1&limit=24")
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Marketplace temporarily unavailable",
    });
  });

  it("returns 400 for an invalid listings limit query", async () => {
    const response = await GET(
      createGetRequest("http://localhost:3000/api/listings?page=1&limit=abc")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid listings query" });
  });

  it("returns 400 for an invalid listings category query", async () => {
    const response = await GET(
      createGetRequest("http://localhost:3000/api/listings?page=1&limit=24&category=bad-category")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid listing category" });
  });

  it("filters placeholder listings from public results", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "listings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "listing-seed",
                  owner_id: "user-seed",
                  title: "[Seed] Test vehicle",
                  description: "Placeholder listing",
                },
                {
                  id: "listing-live",
                  owner_id: USER_ID,
                  title: "Toyota Corolla",
                  description: "Verified listing",
                },
              ],
              count: 2,
              error: null,
            }),
          };
        }

        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [
                  {
                    user_id: USER_ID,
                    display_name: "Nomsa",
                    account_verification_status: "verified",
                  },
                ],
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

    const response = await GET(
      createGetRequest("http://localhost:3000/api/listings?page=1&limit=24")
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.listings).toHaveLength(1);
    expect(json.listings[0].id).toBe("listing-live");
    expect(json.total).toBe(1);
    expect(json.sellers).toHaveLength(1);
  });

  it("falls back to seller_id and normalizes public results back to owner_id", async () => {
    const rangeSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: "listing-live",
          seller_id: USER_ID,
          title: "Toyota Corolla",
          description: "Verified listing",
        },
      ],
      count: 1,
      error: null,
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "listings") {
          return {
            select: vi.fn((fields: string) => {
              if (fields === "id, owner_id") {
                return {
                  limit: vi.fn().mockResolvedValue({
                    error: { code: "42703", message: "column listings.owner_id does not exist" },
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
                neq: vi.fn().mockReturnThis(),
                not: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                range: rangeSpy,
              };
            }),
          };
        }

        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [
                  {
                    user_id: USER_ID,
                    display_name: "Nomsa",
                    account_verification_status: "verified",
                  },
                ],
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

    const response = await GET(
      createGetRequest("http://localhost:3000/api/listings?page=1&limit=24")
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.listings[0]).toMatchObject({
      id: "listing-live",
      owner_id: USER_ID,
      seller_id: USER_ID,
    });
    expect(json.sellers).toMatchObject([
      {
        user_id: USER_ID,
        display_name: "Nomsa",
      },
    ]);
  });

  it.each([
    {
      missingField: "featured_until",
      expectedNullField: "featured_until",
      initialSelect:
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured",
      fallbackSelect:
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured",
    },
    {
      missingField: "condition",
      expectedNullField: "condition",
      initialSelect:
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured",
      fallbackSelect:
        "id, owner_id, title, description, price_cents, price_negotiable, category, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured",
    },
    {
      missingField: "video_thumbnail",
      expectedNullField: "video_thumbnail",
      initialSelect:
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured",
      fallbackSelect:
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured",
    },
    {
      missingField: "logo_url",
      expectedNullField: "logo_url",
      initialSelect:
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured",
      fallbackSelect:
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, location_province, location_city, created_at, boost_until, featured_until, featured",
    },
  ])(
    "returns 200 and normalizes %s when the column is missing",
    async ({ missingField, expectedNullField, initialSelect, fallbackSelect }) => {
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === "listings") {
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
                    neq: vi.fn().mockReturnThis(),
                    not: vi.fn().mockReturnThis(),
                    gte: vi.fn().mockReturnThis(),
                    lte: vi.fn().mockReturnThis(),
                    or: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    range: vi.fn().mockResolvedValue({
                      data: null,
                      count: null,
                      error: {
                        code: "42703",
                        message: `column listings.${missingField} does not exist`,
                      },
                    }),
                  };
                }

                if (fields === fallbackSelect || !fields.includes(missingField)) {
                  return {
                    eq: vi.fn().mockReturnThis(),
                    neq: vi.fn().mockReturnThis(),
                    not: vi.fn().mockReturnThis(),
                    gte: vi.fn().mockReturnThis(),
                    lte: vi.fn().mockReturnThis(),
                    or: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    range: vi.fn().mockResolvedValue({
                      data: null,
                      count: null,
                      error: {
                        code: "42703",
                        message: `column listings.${missingField} does not exist`,
                      },
                    }),
                  };
                }

                if (fields.includes(missingField)) {
                  return {
                    eq: vi.fn().mockReturnThis(),
                    neq: vi.fn().mockReturnThis(),
                    not: vi.fn().mockReturnThis(),
                    gte: vi.fn().mockReturnThis(),
                    lte: vi.fn().mockReturnThis(),
                    or: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    range: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: "listing-live",
                          owner_id: USER_ID,
                          title: "Toyota Corolla",
                          description: "Verified listing",
                          price_cents: 1200000,
                          price_negotiable: false,
                          category: "vehicles",
                          attributes: {},
                          photos: [],
                          videos: [],
                          location_province: "Gauteng",
                          location_city: "Johannesburg",
                          created_at: "2026-03-13T10:00:00.000Z",
                          boost_until: null,
                          featured: false,
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

          if (table === "account_profiles") {
            return {
              select: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    {
                      user_id: USER_ID,
                      display_name: "Nomsa",
                      account_verification_status: "verified",
                    },
                  ],
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

      const response = await GET(
        createGetRequest("http://localhost:3000/api/listings?page=1&limit=24")
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.listings[0]).toMatchObject({
        id: "listing-live",
        owner_id: USER_ID,
        [expectedNullField]: null,
      });
    }
  );
});

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
  attributes: { brand: "Apple" },
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
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
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
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
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

describe("GET /api/listings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

  it("applies placeholder-content exclusions to public listing queries", async () => {
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

    const response = await GET(
      createGetRequest("http://localhost:3000/api/listings?page=1&limit=24")
    );

    expect(response.status).toBe(200);
    expect(notSpy).toHaveBeenCalledWith("title", "ilike", "%seed%");
    expect(notSpy).toHaveBeenCalledWith("title", "ilike", "%[seed]%");
    expect(notSpy).toHaveBeenCalledWith("title", "ilike", "%demo%");
    expect(notSpy).toHaveBeenCalledWith("title", "ilike", "%sample%");
  });

  it("filters placeholder listings from public results", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "listings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
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
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  user_id: USER_ID,
                  display_name: "Nomsa",
                  account_verification_status: "verified",
                },
              ],
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
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  user_id: USER_ID,
                  display_name: "Nomsa",
                  account_verification_status: "verified",
                },
              ],
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
});

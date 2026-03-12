import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { POST, GET } from "@/app/api/promotions/route";
import { GET as GET_DETAIL, PUT, DELETE } from "@/app/api/promotions/[id]/route";

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "user-0001";
const VALID_IMAGE = "https://media.verifymzansi.com/promotions/photo.jpg";

const VALID_BODY = {
  title: "Great Deal on Electronics",
  description:
    "This is a detailed description of our amazing promotion with at least 20 characters.",
  promotion_type: "deal",
  province: "Gauteng",
  city: "Johannesburg",
  contact_methods: ["call"],
  images: [VALID_IMAGE],
};

function createRequest(url: string, opts: { method?: string; body?: unknown } = {}): NextRequest {
  return {
    method: opts.method || "GET",
    json:
      opts.body !== undefined
        ? async () => opts.body
        : async () => {
            throw new Error("No body");
          },
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL(url, "http://localhost:3000"),
  } as unknown as NextRequest;
}

function mockAuth(user: { id: string; email?: string } | null) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: "Not authenticated" },
      }),
    },
  });
}

function mockAdmin(tableOverrides: Record<string, Record<string, unknown>> = {}) {
  const makeChain = (table: string) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: vi.fn().mockImplementation((cb: (v: unknown) => void) => {
      cb({});
      return Promise.resolve();
    }),
    ...(tableOverrides[table] || {}),
  });
  mockCreateAdminClient.mockReturnValue({
    from: vi.fn((table: string) => makeChain(table)),
  });
}

describe("POST /api/promotions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: VALID_BODY,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 404 when account profile not found", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      },
    });
    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: VALID_BODY,
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: "Account profile not found",
    });
  });

  it("returns 400 for invalid body", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "sp-1",
            account_verification_status: "verified",
          },
        }),
      },
    });
    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: { title: "AB" }, // Too short
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
  });

  it("returns verification_required for unverified accounts", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "sp-1",
            account_verification_status: "pending_review",
          },
        }),
      },
    });
    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: VALID_BODY,
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "Verification required",
      code: "verification_required",
    });
  });

  it("creates promotion successfully (201)", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "sp-1",
            account_verification_status: "verified",
          },
        }),
      },
      promotions: {
        single: vi.fn().mockResolvedValue({ data: { id: VALID_UUID }, error: null }),
      },
    });
    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: VALID_BODY,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.promotion.id).toBe(VALID_UUID);
  });

  it("logs audit event on successful creation", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "sp-1",
            account_verification_status: "verified",
          },
        }),
      },
      promotions: {
        single: vi.fn().mockResolvedValue({ data: { id: VALID_UUID }, error: null }),
      },
    });
    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: VALID_BODY,
    });
    await POST(req);
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockLogAuditEvent.mock.calls[0][0].targetType).toBe("promotion");
  });

  it("rejects video uploads when the active plan disallows them", async () => {
    mockAuth({ id: USER_ID });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "sp-1",
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
        if (table === "promotions") {
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
    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: { ...VALID_BODY, videos: ["https://media.verifymzansi.com/promo.mp4"] },
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "Video upload is not available on your current plan.",
    });
  });

  it("rejects off-platform promotion videos before persistence", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "sp-1",
            account_verification_status: "verified",
          },
        }),
      },
    });
    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: { ...VALID_BODY, videos: ["https://example.com/promo.mp4"] },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Validation failed",
      details: {
        videos: expect.arrayContaining(["Videos must be hosted on the VerifyMzansi platform"]),
      },
    });
  });

  it("rejects when api callers exceed the plan video count", async () => {
    mockAuth({ id: USER_ID });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "sp-1",
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
        if (table === "promotions") {
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
    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: {
        ...VALID_BODY,
        videos: [
          "https://media.verifymzansi.com/promo-1.mp4",
          "https://media.verifymzansi.com/promo-2.mp4",
        ],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "Maximum 1 videos allowed on your plan",
    });
  });
});

describe("GET /api/promotions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns promotions list", async () => {
    mockAdmin({
      promotions: {
        range: vi.fn().mockResolvedValue({
          data: [{ id: VALID_UUID, title: "Test", owner_id: USER_ID }],
          count: 1,
          error: null,
        }),
      },
      account_profiles: {
        in: vi.fn().mockResolvedValue({
          data: [
            {
              user_id: USER_ID,
              display_name: "Nomsa",
              account_verification_status: "verified",
            },
          ],
        }),
      },
    });
    const req = createRequest("http://localhost:3000/api/promotions");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.promotions).toHaveLength(1);
    expect(json.accountProfiles).toMatchObject([
      { user_id: USER_ID, display_name: "Nomsa", trust: expect.any(Number) },
    ]);
    expect(json.sellers).toEqual(json.accountProfiles);
    expect(json.total).toBe(1);
  });

  it("handles pagination params", async () => {
    mockAdmin({
      promotions: {
        range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
      },
    });
    const req = createRequest("http://localhost:3000/api/promotions?page=2&limit=10");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.page).toBe(2);
    expect(json.limit).toBe(10);
  });

  it("filters placeholder promotions from public results", async () => {
    mockAdmin({
      promotions: {
        range: vi.fn().mockResolvedValue({
          data: [
            {
              id: "promo-seed",
              title: "[Seed] Launch Campaign",
              description: "Placeholder campaign",
              owner_id: "user-seed",
              business_id: null,
            },
            {
              id: VALID_UUID,
              title: "Summer Sale",
              description: "Verified promotion",
              owner_id: USER_ID,
              business_id: null,
            },
          ],
          count: 2,
          error: null,
        }),
      },
      account_profiles: {
        in: vi.fn().mockResolvedValue({
          data: [
            {
              user_id: USER_ID,
              display_name: "Nomsa",
              account_verification_status: "verified",
            },
          ],
        }),
      },
    });

    const req = createRequest("http://localhost:3000/api/promotions");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.promotions).toHaveLength(1);
    expect(json.promotions[0].id).toBe(VALID_UUID);
    expect(json.total).toBe(1);
    expect(json.accountProfiles).toHaveLength(1);
  });

  it("falls back when the category_key column is unavailable", async () => {
    const promotionsRange = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        count: null,
        error: { message: "column promotions.category_key does not exist" },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: VALID_UUID,
            owner_id: USER_ID,
            title: "Summer Sale",
            description: "Verified promotion",
            promotion_type: "deal",
            category: "Food & Dining",
            business_id: null,
          },
        ],
        count: 1,
        error: null,
      });

    mockAdmin({
      promotions: {
        range: promotionsRange,
      },
      account_profiles: {
        in: vi.fn().mockResolvedValue({
          data: [
            {
              user_id: USER_ID,
              display_name: "Nomsa",
              account_verification_status: "verified",
            },
          ],
        }),
      },
    });

    const req = createRequest("http://localhost:3000/api/promotions");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(promotionsRange).toHaveBeenCalledTimes(2);
    expect(json.promotions[0]).toMatchObject({
      id: VALID_UUID,
      category_key: "food_dining",
    });
  });
});

describe("GET /api/promotions/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid UUID", async () => {
    const req = createRequest("http://localhost:3000/api/promotions/bad-id");
    const res = await GET_DETAIL(req, { params: Promise.resolve({ id: "bad-id" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 for missing promotion", async () => {
    mockAdmin({
      promotions: {
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`);
    const res = await GET_DETAIL(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
  });

  it("returns live promotion publicly", async () => {
    mockAdmin({
      promotions: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: VALID_UUID, status: "live", view_count: 5 },
          error: null,
        }),
        then: vi.fn().mockImplementation((cb: (v: unknown) => void) => {
          cb({});
          return Promise.resolve();
        }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`);
    const res = await GET_DETAIL(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.promotion.id).toBe(VALID_UUID);
  });
});

describe("PUT /api/promotions/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "PUT",
      body: VALID_BODY,
    });
    const res = await PUT(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for missing promotion", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      promotions: {
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "PUT",
      body: VALID_BODY,
    });
    const res = await PUT(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user does not own the promotion", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      promotions: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: VALID_UUID, owner_id: "different-user", status: "live" },
        }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "PUT",
      body: VALID_BODY,
    });
    const res = await PUT(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(403);
  });

  it("updates promotion successfully", async () => {
    mockAuth({ id: USER_ID });
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    // PUT calls from("promotions") twice: once for select, once for update
    let callCount = 0;
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
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
          callCount++;
          if (callCount === 1) {
            // First call: ownership check
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: VALID_UUID, owner_id: USER_ID, status: "live" },
              }),
            };
          }
          // Second call: update
          return {
            update: updateSpy,
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "PUT",
      body: { ...VALID_BODY, business_id: "123e4567-e89b-42d3-a456-426614174000" },
    });
    const res = await PUT(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: "123e4567-e89b-42d3-a456-426614174000",
      })
    );
  });
});

describe("DELETE /api/promotions/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for missing promotion", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      promotions: {
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when promotion is not draft or rejected", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      promotions: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: VALID_UUID, owner_id: USER_ID, status: "live" },
        }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/draft or rejected/i);
  });

  it("deletes draft promotion successfully", async () => {
    mockAuth({ id: USER_ID });
    // DELETE calls from("promotions") twice: once for select, once for delete
    let callCount = 0;
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "promotions") {
          callCount++;
          if (callCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: VALID_UUID, owner_id: USER_ID, status: "draft" },
              }),
            };
          }
          return {
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
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
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("deletes rejected promotion successfully", async () => {
    mockAuth({ id: USER_ID });
    let callCount = 0;
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "promotions") {
          callCount++;
          if (callCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: VALID_UUID, owner_id: USER_ID, status: "rejected" },
              }),
            };
          }
          return {
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
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
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
  });
});

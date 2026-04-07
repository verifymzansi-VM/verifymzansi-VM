import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { resetOwnerColumnCacheForTesting } from "@/lib/account/compat";

const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const { mockEnforceCsrfToken } = vi.hoisted(() => ({
  mockEnforceCsrfToken: vi.fn(),
}));

const { mockHasPhoneNumber } = vi.hoisted(() => ({
  mockHasPhoneNumber: vi.fn(),
}));

const { mockCreateNotification, mockShouldSendOwnerLifecycleNotifications } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn().mockResolvedValue(true),
  mockShouldSendOwnerLifecycleNotifications: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: mockEnforceCsrfToken }));
vi.mock("@/lib/account/require-phone", () => ({ hasPhoneNumber: mockHasPhoneNumber }));
vi.mock("@/lib/notifications", () => ({
  createNotification: mockCreateNotification,
  shouldSendOwnerLifecycleNotifications: mockShouldSendOwnerLifecycleNotifications,
}));

import { POST, GET } from "@/app/api/promotions/route";
import { GET as GET_DETAIL, PUT, DELETE } from "@/app/api/promotions/[id]/route";
import { SOCIAL_AUTHORIZATION_VERSION } from "@/lib/promotions/social-authorization";

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "user-0001";
const VALID_IMAGE = "https://media.verifymzansi.com/promotions/photo.jpg";

const VALID_BODY = {
  title: "Great Deal on Electronics",
  description:
    "This is a detailed description of our amazing promotion with at least 20 characters.",
  promotion_type: "event",
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
    headers: new Headers(),
    nextUrl: new URL(url, "http://localhost:3000"),
    url: new URL(url, "http://localhost:3000").toString(),
  } as unknown as NextRequest;
}

function createCrossSiteRequest(
  url: string,
  opts: { method?: string; body?: unknown } = {}
): NextRequest {
  return {
    method: opts.method || "GET",
    json:
      opts.body !== undefined
        ? async () => opts.body
        : async () => {
            throw new Error("No body");
          },
    headers: new Headers({ origin: "https://evil.example" }),
    nextUrl: new URL(url, "https://verifymzansi.com"),
    url: new URL(url, "https://verifymzansi.com").toString(),
  } as unknown as NextRequest;
}

function mockAuth(user: { id: string; email?: string } | null) {
  const fallbackFrom = (table: string) => {
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
  };

  mockCreateClient.mockResolvedValue({
    from: vi.fn(fallbackFrom),
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
    rpc: vi.fn().mockResolvedValue({ error: null }),
  });
}

describe("POST /api/promotions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
    mockEnforceCsrfToken.mockReturnValue(null);
    mockHasPhoneNumber.mockResolvedValue(true);
    mockShouldSendOwnerLifecycleNotifications.mockReturnValue(true);
  });

  it("rejects requests missing a CSRF token", async () => {
    mockEnforceCsrfToken.mockReturnValue(
      Response.json({ error: "Invalid CSRF token" }, { status: 403 })
    );
    mockAuth({ id: USER_ID });

    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: VALID_BODY,
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid CSRF token" });
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: VALID_BODY,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects cross-site promotion creation requests", async () => {
    const req = createCrossSiteRequest("/api/promotions", {
      method: "POST",
      body: VALID_BODY,
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
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

  it("rejects incomplete granted social authorization payloads", async () => {
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
      body: {
        ...VALID_BODY,
        socialAuthorization: {
          granted: true,
          authorizerName: "Nomsa Dlamini",
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Validation failed",
      details: {
        "socialAuthorization.authorizerRole": expect.any(String),
      },
    });
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
      verification_steps: {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [] }),
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

  it("blocks a second free promotion post when no paid plan exists", async () => {
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

    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: VALID_BODY,
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "Free post already used",
    });
  });

  it("does not claim a free post before validation passes", async () => {
    const freePostInsert = vi.fn().mockResolvedValue({ error: null });

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

    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: { title: "AB" },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(freePostInsert).not.toHaveBeenCalled();
  });

  it("allows promotion creation when the profile is stale but all verification steps are approved", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "sp-1",
            account_verification_status: "incomplete",
          },
        }),
      },
      verification_steps: {
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
      },
      promotions: {
        single: vi.fn().mockResolvedValue({ data: { id: VALID_UUID }, error: null }),
      },
      entitlements: {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { tier: "basic" } }),
      },
    });
    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: VALID_BODY,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
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
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        title: "Tourism & Event post submitted",
        href: "/dashboard/promotions",
      })
    );
  });

  it("returns 404 when linked business is not owned by the caller", async () => {
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
      businesses: {
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      },
    });

    const req = createRequest("http://localhost:3000/api/promotions", {
      method: "POST",
      body: { ...VALID_BODY, business_id: "123e4567-e89b-42d3-a456-426614174000" },
    });
    const res = await POST(req);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "Linked business not found" });
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

  it("logs a dedicated audit event when social authorization is granted on create", async () => {
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
      body: {
        ...VALID_BODY,
        socialAuthorization: {
          granted: true,
          authorizerName: "Nomsa Dlamini",
          authorizerRole: "Owner",
          relationship: "owner",
          monetizationAcknowledged: true,
          acceptedVersion: SOCIAL_AUTHORIZATION_VERSION,
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(2);
    expect(mockLogAuditEvent.mock.calls[1][0]).toMatchObject({
      action: "promotion_social_authorization_granted",
      targetId: VALID_UUID,
    });
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
        "videos.0": "Videos must be hosted on the VerifyMzansi platform",
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
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

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

  it("only returns live linked businesses in public promotion results", async () => {
    mockAdmin({
      promotions: {
        range: vi.fn().mockResolvedValue({
          data: [
            { id: VALID_UUID, title: "Test", owner_id: USER_ID, business_id: "business-live" },
          ],
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
      businesses: {
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [{ id: "business-live", business_name: "Visible Business" }],
          }),
        }),
      },
    });

    const req = createRequest("http://localhost:3000/api/promotions");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.businesses).toEqual([{ id: "business-live", business_name: "Visible Business" }]);
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
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

  it("rejects invalid UUID", async () => {
    const req = createRequest("http://localhost:3000/api/promotions/bad-id");
    const res = await GET_DETAIL(req, { params: Promise.resolve({ id: "bad-id" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 for missing promotion", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ error: null }) });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`);
    const res = await GET_DETAIL(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
  });

  it("returns live promotion publicly", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: VALID_UUID,
            status: "live",
            view_count: 5,
            social_distribution_authorized: true,
            social_authorizer_name: "Nomsa Dlamini",
            social_authorizer_role: "Owner",
          },
          error: null,
        }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ error: null }) });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`);
    const res = await GET_DETAIL(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.promotion.id).toBe(VALID_UUID);
    expect(json.promotion.socialAuthorizationStatus).toBe("authorized");
    expect(json.promotion.socialAuthorization).toBeUndefined();
  });

  it("returns 404 for non-live promotions when the viewer is not the owner", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: VALID_UUID, status: "draft", owner_id: "owner-2" },
          error: null,
        }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ error: null }) });

    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`);
    const res = await GET_DETAIL(req, { params: Promise.resolve({ id: VALID_UUID }) });

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/promotions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

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
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "PUT",
      body: VALID_BODY,
    });
    const res = await PUT(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 when user does not own the promotion", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "PUT",
      body: VALID_BODY,
    });
    const res = await PUT(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
  });

  it("updates promotion successfully", async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "123e4567-e89b-42d3-a456-426614174000", owner_id: USER_ID },
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
      if (table === "promotions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: VALID_UUID, owner_id: USER_ID, status: "live" },
          }),
          update: vi.fn().mockReturnValue({
            eq: updateEq,
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      };
    });
    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "PUT",
      body: { ...VALID_BODY, business_id: "123e4567-e89b-42d3-a456-426614174000" },
    });
    const res = await PUT(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(updateEq).toHaveBeenCalledWith("id", VALID_UUID);
  });

  it("logs a revocation audit event when social authorization is removed", async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: VALID_UUID,
              owner_id: USER_ID,
              status: "live",
              social_distribution_authorized: true,
              social_distribution_authorized_at: "2026-03-23T09:00:00.000Z",
              social_authorizer_name: "Nomsa Dlamini",
              social_authorizer_role: "Owner",
              social_authorizer_relationship: "owner",
              social_authorization_version: SOCIAL_AUTHORIZATION_VERSION,
              social_monetization_acknowledged: true,
            },
          }),
          update: vi.fn().mockReturnValue({
            eq: updateEq,
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      };
    });
    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });

    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "PUT",
      body: {
        ...VALID_BODY,
        socialAuthorization: { granted: false },
      },
    });
    const res = await PUT(req, { params: Promise.resolve({ id: VALID_UUID }) });

    expect(res.status).toBe(200);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "promotion_social_authorization_revoked",
        targetId: VALID_UUID,
      })
    );
  });

  it("returns 404 when updating to a linked business the caller does not own", async () => {
    const from = vi.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
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
      if (table === "promotions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: VALID_UUID, owner_id: USER_ID, status: "live" },
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      };
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });

    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "PUT",
      body: { ...VALID_BODY, business_id: "123e4567-e89b-42d3-a456-426614174000" },
    });
    const res = await PUT(req, { params: Promise.resolve({ id: VALID_UUID }) });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "Linked business not found" });
  });
});

describe("DELETE /api/promotions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for missing promotion", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when promotion is not draft or rejected", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: VALID_UUID, owner_id: USER_ID, status: "live" },
        }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
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
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    mockCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "promotions") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: VALID_UUID, owner_id: USER_ID, status: "draft" },
            }),
            delete: vi.fn().mockReturnValue({ eq: deleteEq }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(deleteEq).toHaveBeenCalledWith("id", VALID_UUID);
  });

  it("deletes rejected promotion successfully", async () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    mockCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "promotions") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: VALID_UUID, owner_id: USER_ID, status: "rejected" },
            }),
            delete: vi.fn().mockReturnValue({ eq: deleteEq }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}`, {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
    expect(deleteEq).toHaveBeenCalledWith("id", VALID_UUID);
  });
});

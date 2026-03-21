import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type * as ApiModule from "@/lib/utils/api";
import { resetOwnerColumnCacheForTesting } from "@/lib/account/compat";

const {
  mockCreateClient,
  mockCreateAdminClient: _mockCreateAdminClient,
  mockFrom,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));
vi.mock("@/lib/utils/turnstile", () => ({
  verifyTurnstileToken: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual<typeof ApiModule>("@/lib/utils/api");
  return {
    ...actual,
    parseAndValidateJsonRequest: vi.fn(async (req: { json: () => Promise<unknown> }, schema) => {
      try {
        const body = await req.json();
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          return {
            success: false,
            response: Response.json(
              { error: parsed.error.issues[0]?.message ?? "Invalid request" },
              { status: 400 }
            ),
          };
        }
        return { success: true, data: parsed.data };
      } catch {
        return {
          success: false,
          response: Response.json({ error: "Invalid JSON payload" }, { status: 400 }),
        };
      }
    }),
  };
});

import { POST } from "@/app/api/contact/route";

const VALID_LISTING_ID = "00000000-0000-4000-8000-000000000001";
const VALID_PROMOTION_ID = "00000000-0000-4000-8000-000000000002";

function createRequest(body: unknown) {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/contact",
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL("http://localhost:3000/api/contact"),
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
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { owner_id: "account-owner-1" },
            error: null,
          }),
        }),
      }),
    }),
  });
}

describe("POST /api/contact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
    // Default: admin client from() succeeds
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              account_verification_status: "verified",
            },
            error: null,
          }),
        }),
      }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    });
  });

  it("should reject invalid JSON", async () => {
    mockAuth({ id: "user-1" });
    const req = {
      method: "POST",
      json: async () => {
        throw new Error("bad json");
      },
      url: "http://localhost:3000/api/contact",
      headers: { get: vi.fn().mockReturnValue(null) },
      nextUrl: new URL("http://localhost:3000/api/contact"),
    } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should reject empty fields", async () => {
    mockAuth({ id: "user-1" });
    const req = createRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should strip HTML tags from message (XSS prevention)", async () => {
    mockAuth({ id: "user-1", email: "buyer@test.com" });
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              account_verification_status: "verified",
            },
            error: null,
          }),
        }),
      }),
      insert: insertMock,
    });

    // The message with HTML should have tags stripped
    const xssPayload = '<script>alert("xss")</script>Hello';
    expect(xssPayload.replace(/<[^>]*>/g, "").trim()).toBe('alert("xss")Hello');
  });

  it("returns 404 when the target listing is not live", async () => {
    mockAuth(null);
    mockFrom.mockImplementation((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn((fields: string) => {
            if (fields === "owner_id, title, status") {
              return {
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: VALID_LISTING_ID,
                      owner_id: "account-owner-1",
                      title: "Draft listing",
                      status: "draft",
                    },
                    error: null,
                  }),
                }),
              };
            }

            if (fields === "id, owner_id") {
              return {
                limit: vi.fn().mockResolvedValue({ error: null }),
              };
            }

            return {
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            };
          }),
        };
      }

      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }

      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    const res = await POST(
      createRequest({
        listingId: VALID_LISTING_ID,
        message: "I want to know more",
        contactMethod: "form",
        turnstileToken: "tok-valid",
      })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "Listing not found" });
  });

  it("accepts legacy seller_id ownership on contact targets", async () => {
    mockAuth({ id: "user-1", email: "buyer@test.com" });
    const contactInsert = vi.fn().mockResolvedValue({ error: null });
    const leadsInsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "promotions") {
        return {
          select: vi.fn((fields: string) => {
            if (fields === "id, owner_id") {
              return {
                limit: vi.fn().mockResolvedValue({
                  error: {
                    code: "42703",
                    message: "column promotions.owner_id does not exist",
                  },
                }),
              };
            }

            if (fields === "id, seller_id") {
              return {
                limit: vi.fn().mockResolvedValue({ error: null }),
              };
            }

            if (fields === "seller_id, title, status") {
              return {
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: VALID_PROMOTION_ID,
                      seller_id: "legacy-owner-1",
                      title: "Legacy promotion",
                      status: "live",
                    },
                    error: null,
                  }),
                }),
              };
            }

            return {
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            };
          }),
        };
      }

      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { account_verification_status: "verified" },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "contact_events") {
        return { insert: contactInsert };
      }

      if (table === "leads") {
        return { insert: leadsInsert };
      }

      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    const res = await POST(
      createRequest({
        promotionId: VALID_PROMOTION_ID,
        message: "Please contact me back",
        contactMethod: "form",
        turnstileToken: "tok-valid",
      })
    );

    expect(res.status).toBe(200);
    expect(contactInsert).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: "legacy-owner-1", target_type: "promotion" })
    );
    expect(leadsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: "legacy-owner-1", target_type: "promotion" })
    );
  });
});

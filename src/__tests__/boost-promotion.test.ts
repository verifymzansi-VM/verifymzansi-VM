import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { resetOwnerColumnCacheForTesting } from "@/lib/account/compat";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/utils/csrf";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockLogAuditEvent,
  mockCheckRateLimit,
  mockGetClientIp,
  mockClientFrom,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockClientFrom: vi.fn(),
}));

const mockCreateHostedCheckout = vi.fn().mockResolvedValue({
  paymentId: "payment-1",
  checkoutUrl: "https://pay.ozow.test/checkout",
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => {
    const vars: Record<string, string> = {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      OZOW_ENV: "staging",
    };
    return vars[key] ?? "";
  }),
}));
vi.mock("@/lib/payments/checkout", () => ({
  createHostedCheckout: (...args: unknown[]) => mockCreateHostedCheckout(...args),
}));
vi.mock("@/lib/services/entitlements", () => ({
  canBoost: vi.fn(() => ({ allowed: true })),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));
vi.mock("@/lib/services/plan-tier", () => ({
  getActivePlanTierForArea: vi.fn().mockResolvedValue("growth"),
}));
vi.mock("@/lib/constants/pricing", () => ({
  ADDON_PRICES: { boost: 1500, featured: 2500, urgent: 1000 },
  BOOST_DURATION_DAYS: 7,
}));

import { POST } from "@/app/api/promotions/[id]/boost/route";

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "user-0001";
const VALID_CSRF_TOKEN = "a".repeat(64);

function createRequest(url: string): NextRequest {
  const headers = new Headers();
  headers.set(CSRF_HEADER_NAME, VALID_CSRF_TOKEN);
  headers.set("cookie", `${CSRF_COOKIE_NAME}=${VALID_CSRF_TOKEN}`);

  return {
    method: "POST",
    json: async () => ({}),
    headers,
    nextUrl: new URL(url, "http://localhost:3000"),
    url,
  } as unknown as NextRequest;
}

function mockAuth(user: { id: string; email?: string } | null) {
  mockCreateClient.mockResolvedValue({
    from: mockClientFrom,
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
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    single: vi.fn().mockResolvedValue({ data: { id: "payment-1" }, error: null }),
    insert: vi.fn().mockReturnThis(),
    ...(tableOverrides[table] || {}),
  });
  mockCreateAdminClient.mockReturnValue({
    from: vi.fn((table: string) => makeChain(table)),
  });
}

function mockPromotionRow(row: Record<string, unknown> | null) {
  mockClientFrom.mockImplementation((table: string) => {
    if (table === "promotions") {
      return {
        select: vi.fn((fields: string) => {
          if (fields === "id, owner_id") {
            return {
              limit: vi.fn().mockResolvedValue({ error: null }),
            };
          }

          return {
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: row }),
          };
        }),
      };
    }

    throw new Error(`Unexpected client table ${table}`);
  });
}

function setupHappyPath() {
  mockAuth({ id: USER_ID, email: "test@example.com" });
  mockPromotionRow({
    id: VALID_UUID,
    title: "Test Promotion",
    status: "live",
    owner_id: USER_ID,
    boost_until: null,
  });
  mockAdmin({
    account_profiles: {
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
    },
    payments: {
      single: vi.fn().mockResolvedValue({ data: { id: "payment-1" }, error: null }),
    },
  });
}

describe("POST /api/promotions/[id]/boost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientFrom.mockImplementation((table: string) => {
      if (table === "promotions") {
        return {
          select: vi.fn((fields: string) => {
            if (fields === "id, owner_id") {
              return {
                limit: vi.fn().mockResolvedValue({ error: null }),
              };
            }

            return {
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            };
          }),
        };
      }

      throw new Error(`Unexpected client table ${table}`);
    });
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockCreateHostedCheckout.mockResolvedValue({
      paymentId: "payment-1",
      checkoutUrl: "https://pay.ozow.test/checkout",
    });
    resetOwnerColumnCacheForTesting();
  });

  it("rejects invalid UUID", async () => {
    mockAuth({ id: USER_ID });
    const req = createRequest("http://localhost:3000/api/promotions/not-a-uuid/boost");
    const res = await POST(req, { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid");
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when account profile not found", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Account profile not found");
  });

  it("returns 404 when promotion not found", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Tourism & Events post not found");
  });

  it("returns 404 when user does not own the promotion", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Tourism & Events post not found");
  });

  it("accepts legacy seller_id ownership when promotions still use the old column", async () => {
    mockAuth({ id: USER_ID });
    mockClientFrom.mockImplementation((table: string) => {
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
            return {
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: VALID_UUID,
                  title: "Legacy Promo",
                  status: "live",
                  seller_id: USER_ID,
                  boost_until: null,
                },
              }),
            };
          }),
        };
      }

      throw new Error(`Unexpected client table ${table}`);
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
          };
        }
        if (table === "payments") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            contains: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: "payment-1" }, error: null }),
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

    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.paymentId).toBe("payment-1");
  });

  it("returns 400 when promotion is not live", async () => {
    mockAuth({ id: USER_ID });
    mockPromotionRow({
      id: VALID_UUID,
      title: "Draft Promo",
      status: "draft",
      owner_id: USER_ID,
      boost_until: null,
    });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/only live/i);
  });

  it("returns 400 when promotion is already boosted", async () => {
    mockAuth({ id: USER_ID });
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    mockPromotionRow({
      id: VALID_UUID,
      title: "Boosted Promo",
      status: "live",
      owner_id: USER_ID,
      boost_until: futureDate,
    });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already/i);
  });

  it("returns 500 when payment creation fails", async () => {
    mockAuth({ id: USER_ID });
    mockPromotionRow({
      id: VALID_UUID,
      title: "Test Promo",
      status: "live",
      owner_id: USER_ID,
      boost_until: null,
    });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
    });
    mockCreateHostedCheckout.mockRejectedValueOnce(new Error("Checkout provider unavailable"));
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/boost checkout/i);
  });

  it("happy path: returns checkout URL and payment ID", async () => {
    setupHappyPath();
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkoutUrl).toBe("https://pay.ozow.test/checkout");
    expect(body.paymentId).toBe("payment-1");
    expect(mockCreateHostedCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ area: "PROMOTIONS_EVENTS" })
    );
  });

  it("passes amount cents to the hosted checkout helper", async () => {
    setupHappyPath();
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });

    expect(mockCreateHostedCheckout).toHaveBeenCalledTimes(1);
    const passedParams = mockCreateHostedCheckout.mock.calls[0][0];
    expect(passedParams.amountCents).toBe(1500);
  });

  it("logs audit event on successful checkout", async () => {
    setupHappyPath();
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const auditEntry = mockLogAuditEvent.mock.calls[0][0];
    expect(auditEntry.actorId).toBe(USER_ID);
    expect(auditEntry.targetId).toBe(VALID_UUID);
    expect(auditEntry.targetType).toBe("promotion");
    expect(auditEntry.action).toBe("promotion_boosted");
  });
});

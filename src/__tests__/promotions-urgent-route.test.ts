import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/* ── hoisted mocks ─────────────────────────────────────── */
const { mockGetUser } = vi.hoisted(() => ({ mockGetUser: vi.fn() }));
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
const { mockAdminFrom } = vi.hoisted(() => ({ mockAdminFrom: vi.fn() }));
const { mockCheckRateLimit } = vi.hoisted(() => ({ mockCheckRateLimit: vi.fn() }));
const { mockCanUrgent } = vi.hoisted(() => ({ mockCanUrgent: vi.fn() }));
const { mockCreateHostedCheckout } = vi.hoisted(() => ({ mockCreateHostedCheckout: vi.fn() }));
const { mockGetActivePlanTier } = vi.hoisted(() => ({ mockGetActivePlanTier: vi.fn() }));
const { mockGetOwnerColumn, mockApplyOwnerFilter, mockReadOwnerId } = vi.hoisted(() => ({
  mockGetOwnerColumn: vi.fn(),
  mockApplyOwnerFilter: vi.fn(),
  mockReadOwnerId: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: vi.fn(() => null),
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));

vi.mock("@/lib/services/entitlements", () => ({
  canUrgent: mockCanUrgent,
}));

vi.mock("@/lib/payments/checkout", () => ({
  createHostedCheckout: mockCreateHostedCheckout,
}));

vi.mock("@/lib/services/plan-tier", () => ({
  getActivePlanTierForArea: mockGetActivePlanTier,
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/config/env", () => ({
  env: vi.fn(() => "https://verifymzansi.com"),
}));

vi.mock("@/lib/account/compat", () => ({
  getOwnerColumn: mockGetOwnerColumn,
  applyOwnerFilter: mockApplyOwnerFilter,
  readOwnerId: mockReadOwnerId,
  withOwnerColumn: vi.fn((cols: string) => cols),
  ACCOUNT_PROFILE_NOT_FOUND_ERROR: "Account profile not found",
}));

import { POST } from "@/app/api/promotions/[id]/urgent/route";

const USER = { id: "user-1", email: "test@test.com" };
const PROMOTION_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeRequest(): NextRequest {
  return {
    method: "POST",
    url: "http://localhost:3000/api/promotions/" + PROMOTION_ID + "/urgent",
    headers: new Headers({ origin: "http://localhost:3000" }),
    nextUrl: new URL("http://localhost:3000/api/promotions/" + PROMOTION_ID + "/urgent"),
  } as unknown as NextRequest;
}

function makeParams(id = PROMOTION_ID) {
  return { params: Promise.resolve({ id }) };
}

function chainable() {
  const self: Record<string, unknown> = {};
  const proxy = new Proxy(self, {
    get: (_t, prop) => {
      if (prop === "then" || prop === "catch") return undefined;
      return (..._args: unknown[]) => proxy;
    },
  });
  return proxy;
}

function setupHappyPath() {
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockCheckRateLimit.mockResolvedValue({ limited: false });
  mockGetOwnerColumn.mockResolvedValue("owner_id");
  mockReadOwnerId.mockReturnValue(USER.id);

  // supabase.from() returns a chainable query builder
  mockFrom.mockReturnValue(chainable());

  // admin: account_profiles + payments lookup
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "account_profiles") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
          }),
        }),
      };
    }
    if (table === "payments") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              contains: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      };
    }
    return {};
  });

  // supabase: promotion lookup via applyOwnerFilter
  const promotionData = {
    id: PROMOTION_ID,
    title: "Test Promo",
    status: "live",
    owner_id: USER.id,
    urgent_until: null,
  };
  mockApplyOwnerFilter.mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data: promotionData }),
  });

  mockGetActivePlanTier.mockResolvedValue("pro");
  mockCanUrgent.mockReturnValue({ allowed: true });
  mockCreateHostedCheckout.mockResolvedValue({
    paymentId: "pay-1",
    checkoutUrl: "https://pay.ozow.com/checkout",
  });
}

describe("POST /api/promotions/[id]/urgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfter: 60, degraded: false });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(429);
  });

  it("returns 503 when rate limiter is degraded", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfter: 60, degraded: true });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(503);
  });

  it("returns 404 when account profile not found", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 404 when promotion not found", async () => {
    mockApplyOwnerFilter.mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 403 when user does not own promotion", async () => {
    mockReadOwnerId.mockReturnValue("other-user");
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(403);
  });

  it("returns 400 when promotion is not live", async () => {
    mockApplyOwnerFilter.mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: PROMOTION_ID,
          title: "P",
          status: "draft",
          owner_id: USER.id,
          urgent_until: null,
        },
      }),
    });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(400);
  });

  it("returns 400 when promotion is already urgent", async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    mockApplyOwnerFilter.mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: PROMOTION_ID,
          title: "P",
          status: "live",
          owner_id: USER.id,
          urgent_until: futureDate,
        },
      }),
    });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(400);
  });

  it("returns 409 when duplicate payment is in flight", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: "p-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "payments") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                contains: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "pmt-dup" }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(409);
  });

  it("returns 403 when entitlement check fails", async () => {
    mockCanUrgent.mockReturnValue({ allowed: false, reason: "Upgrade plan" });
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Upgrade plan");
  });

  it("returns success with checkout URL on happy path", async () => {
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkoutUrl).toBe("https://pay.ozow.com/checkout");
    expect(body.paymentId).toBe("pay-1");
  });
});

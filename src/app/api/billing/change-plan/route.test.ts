import { describe, it, expect, vi, beforeEach } from "vitest";
import { type NextRequest } from "next/server";
import { POST as changePlanRoute } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHostedCheckout } from "@/lib/payments/checkout";
import { getStablePlanId } from "@/lib/constants/plan-ids";

const CSRF_TOKEN = "a".repeat(64);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/payments/checkout", () => ({
  createHostedCheckout: vi.fn().mockResolvedValue({
    paymentId: "pay-change-1",
    checkoutUrl: "https://pay.ozow.com/checkout/pay-change-1",
  }),
}));

vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => (key === "NEXT_PUBLIC_APP_URL" ? "https://verifymzansi.com" : "")),
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

function createMockRequest(body: Record<string, unknown>) {
  const url = "https://verifymzansi.com/api/billing/change-plan";
  const request = new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "https://verifymzansi.com",
      "sec-fetch-site": "same-origin",
      cookie: `vm_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    },
  });

  return Object.assign(request, {
    nextUrl: new URL(url),
  }) as NextRequest;
}

function createPlansTableMock(
  rows: Array<Record<string, unknown>>,
  options?: { requireDirectIdMiss?: boolean }
) {
  return {
    select: vi.fn().mockReturnValue({
      eq(column: string, value: unknown) {
        const filters: Array<[string, unknown]> = [[column, value]];
        const chain = {
          eq(nextColumn: string, nextValue: unknown) {
            filters.push([nextColumn, nextValue]);
            return chain;
          },
          maybeSingle: vi.fn().mockImplementation(async () => {
            const directIdLookup =
              filters.length === 1 &&
              filters[0]?.[0] === "id" &&
              typeof filters[0]?.[1] === "string";

            if (directIdLookup && options?.requireDirectIdMiss) {
              return { data: null, error: null };
            }

            const match =
              rows.find((row) => filters.every(([key, expected]) => row[key] === expected)) ?? null;
            return { data: match, error: null };
          }),
        };
        return chain;
      },
    }),
  };
}

describe("POST /api/billing/change-plan", () => {
  const mockSupabase = {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  };

  const mockAdmin = {
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never);
  });

  it("returns 401 when user is unauthenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    const res = await changePlanRoute(
      createMockRequest({
        currentEntitlementId: "550e8400-e29b-41d4-a716-446655440000",
        newPlanId: "550e8400-e29b-41d4-a716-446655440001",
      })
    );

    expect(res.status).toBe(401);
  });

  it("returns 404 when current entitlement does not exist", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await changePlanRoute(
      createMockRequest({
        currentEntitlementId: "550e8400-e29b-41d4-a716-446655440000",
        newPlanId: "550e8400-e29b-41d4-a716-446655440001",
      })
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 when changing across different areas", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "ent-1",
              user_id: "user-1",
              area: "MZANSI_MARKET",
              tier: "growth",
              status: "active",
            },
            error: null,
          }),
        };
      }
      if (table === "plans") {
        return createPlansTableMock([
          {
            id: "550e8400-e29b-41d4-a716-446655440001",
            name: "Business Pro",
            area: "MZANSI_BUSINESS",
            tier: "pro",
            price_cents: 45000,
            active: true,
          },
        ]);
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await changePlanRoute(
      createMockRequest({
        currentEntitlementId: "550e8400-e29b-41d4-a716-446655440000",
        newPlanId: "550e8400-e29b-41d4-a716-446655440001",
      })
    );

    expect(res.status).toBe(400);
  });

  it("starts checkout for a valid plan change", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "ent-1",
              user_id: "user-1",
              area: "MZANSI_MARKET",
              tier: "starter",
              status: "active",
            },
            error: null,
          }),
        };
      }
      if (table === "plans") {
        return createPlansTableMock([
          {
            id: "550e8400-e29b-41d4-a716-446655440001",
            name: "Market Growth",
            area: "MZANSI_MARKET",
            tier: "growth",
            price_cents: 25000,
            active: true,
          },
        ]);
      }
      if (table === "payments") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await changePlanRoute(
      createMockRequest({
        currentEntitlementId: "550e8400-e29b-41d4-a716-446655440000",
        newPlanId: "550e8400-e29b-41d4-a716-446655440001",
      })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.paymentId).toBe("pay-change-1");
    expect(vi.mocked(createHostedCheckout)).toHaveBeenCalledOnce();
    expect(vi.mocked(createHostedCheckout)).toHaveBeenCalledWith(
      expect.objectContaining({
        providerData: expect.objectContaining({
          plan_id: "550e8400-e29b-41d4-a716-446655440001",
        }),
      })
    );
  });

  it("resolves stable frontend plan tokens during plan changes", async () => {
    const canonicalPlanId = "db-plan-growth";
    const stablePlanToken = getStablePlanId("MZANSI_MARKET", "growth");

    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "ent-1",
              user_id: "user-1",
              area: "MZANSI_MARKET",
              tier: "starter",
              status: "active",
            },
            error: null,
          }),
        };
      }
      if (table === "plans") {
        return createPlansTableMock(
          [
            {
              id: canonicalPlanId,
              name: "Market Growth",
              area: "MZANSI_MARKET",
              tier: "growth",
              price_cents: 25000,
              active: true,
            },
          ],
          { requireDirectIdMiss: true }
        );
      }
      if (table === "payments") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await changePlanRoute(
      createMockRequest({
        currentEntitlementId: "550e8400-e29b-41d4-a716-446655440000",
        newPlanId: stablePlanToken,
      })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(vi.mocked(createHostedCheckout)).toHaveBeenCalledWith(
      expect.objectContaining({
        providerData: expect.objectContaining({
          plan_id: canonicalPlanId,
          plan_tier: "growth",
          area: "MZANSI_MARKET",
        }),
      })
    );
  });
});

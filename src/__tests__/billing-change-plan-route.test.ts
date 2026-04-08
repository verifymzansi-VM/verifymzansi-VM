import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCheckRateLimit,
  mockGetClientIp,
  mockParseAndValidateJsonRequest,
  mockResolveBillingPlanSelection,
  mockCreateHostedCheckout,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockParseAndValidateJsonRequest: vi.fn(),
  mockResolveBillingPlanSelection: vi.fn(),
  mockCreateHostedCheckout: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));
vi.mock("@/lib/utils/api", () => ({
  parseAndValidateJsonRequest: mockParseAndValidateJsonRequest,
}));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: vi.fn(() => null) }));
vi.mock("@/lib/utils/mutation-origin", () => ({ enforceSameOriginMutation: vi.fn(() => null) }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("@/lib/billing/plan-resolver", () => ({
  resolveBillingPlanSelection: mockResolveBillingPlanSelection,
}));
vi.mock("@/lib/payments/checkout", () => ({
  createHostedCheckout: mockCreateHostedCheckout,
}));
vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => {
    if (key === "NEXT_PUBLIC_APP_URL") return "http://localhost:3000";
    return "";
  }),
}));

import { POST } from "@/app/api/billing/change-plan/route";

function makeRequest() {
  return {
    method: "POST",
    url: "http://localhost:3000/api/billing/change-plan",
    headers: new Headers(),
    cookies: { get: () => undefined },
    nextUrl: new URL("http://localhost:3000/api/billing/change-plan"),
  } as unknown as NextRequest;
}

describe("POST /api/billing/change-plan", () => {
  const adminFrom = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "u1", email_confirmed_at: new Date().toISOString() } },
          error: null,
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({ from: adminFrom });
    mockParseAndValidateJsonRequest.mockResolvedValue({
      success: true,
      data: { currentEntitlementId: "ent-1", newPlanId: "plan-2" },
    });
  });

  it("blocks plan downgrades (pro → growth)", async () => {
    adminFrom.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  gte: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: "ent-1",
                        user_id: "u1",
                        area: "MZANSI_MARKET",
                        tier: "pro",
                        status: "active",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    mockResolveBillingPlanSelection.mockResolvedValue({
      plan: {
        id: "plan-2",
        area: "MZANSI_MARKET",
        tier: "growth",
        price_cents: 5000,
        active: true,
      },
      error: null,
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("downgrades");
  });

  it("blocks same-tier change (growth → growth)", async () => {
    adminFrom.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  gte: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: "ent-1",
                        user_id: "u1",
                        area: "MZANSI_MARKET",
                        tier: "growth",
                        status: "active",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    mockResolveBillingPlanSelection.mockResolvedValue({
      plan: {
        id: "plan-2",
        area: "MZANSI_MARKET",
        tier: "growth",
        price_cents: 5000,
        active: true,
      },
      error: null,
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already on this plan");
  });

  it("allows pending_verification entitlements to change plans", async () => {
    adminFrom.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  gte: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: "ent-1",
                        user_id: "u1",
                        area: "MZANSI_MARKET",
                        tier: "starter",
                        status: "pending_verification",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "payments") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    mockResolveBillingPlanSelection.mockResolvedValue({
      plan: {
        id: "plan-2",
        area: "MZANSI_MARKET",
        tier: "growth",
        price_cents: 5000,
        active: true,
      },
      error: null,
    });

    mockCreateHostedCheckout.mockResolvedValue({
      checkoutUrl: "https://pay.ozow.test/checkout",
      paymentId: "pay-1",
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checkoutUrl).toBe("https://pay.ozow.test/checkout");
  });
});

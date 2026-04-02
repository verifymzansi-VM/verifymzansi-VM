import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as createCheckout } from "@/app/api/billing/create-checkout/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHostedCheckout } from "@/lib/payments/checkout";
import { type NextRequest } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { getStablePlanId } from "@/lib/constants/plan-ids";
import {
  OzowAuthenticationError,
  OzowConfigurationError,
  OzowProviderError,
} from "@/lib/payments/ozow";

const CSRF_TOKEN = "a".repeat(64);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/payments/checkout", () => ({
  createHostedCheckout: vi.fn().mockResolvedValue({
    paymentId: "pay-001",
    checkoutUrl: "https://pay.ozow.com/checkout/pay-001",
  }),
}));

vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => {
    const envMap: Record<string, string> = {
      NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
      OZOW_ENV: "staging",
      OZOW_CLIENT_ID: "test-client-id",
      OZOW_CLIENT_SECRET: "test-client-secret", // secret-scan: allow
      OZOW_SITE_CODE: "test-site-code",
      OZOW_WEBHOOK_SECRET: "test-webhook-secret", // secret-scan: allow
    };
    return envMap[key] ?? "";
  }),
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

function createBillingRequest(
  body: Record<string, unknown>,
  options?: { origin?: string; includeCsrf?: boolean; secFetchSite?: string }
) {
  const url = "https://verifymzansi.com/api/billing/create-checkout";
  const includeCsrf = options?.includeCsrf ?? true;
  const headers = new Headers({
    "content-type": "application/json",
    origin: options?.origin ?? "https://verifymzansi.com",
    "sec-fetch-site": options?.secFetchSite ?? "same-origin",
  });

  if (includeCsrf) {
    headers.set("cookie", `vm_csrf=${CSRF_TOKEN}`);
    headers.set("x-csrf-token", CSRF_TOKEN);
  }

  const request = new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });

  return Object.assign(request, {
    nextUrl: new URL(url),
  }) as NextRequest;
}

function createMockRequest(body: Record<string, unknown>) {
  return createBillingRequest(body);
}

function createCrossSiteRequest(body: Record<string, unknown>) {
  return createBillingRequest(body, {
    origin: "https://evil.example",
    secFetchSite: "cross-site",
  });
}

function createMissingCsrfRequest(body: Record<string, unknown>) {
  return createBillingRequest(body, { includeCsrf: false });
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

describe("POST /api/billing/create-checkout", () => {
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
    mockSupabase.from.mockImplementation((table: string) => mockAdmin.from(table));
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "profile-1", display_name: "Test Account" },
          }),
        };
      }
      if (table === "plans") {
        return createPlansTableMock([
          {
            id: "550e8400-e29b-41d4-a716-446655440000",
            name: "Mzansi Market Growth",
            area: "MZANSI_MARKET",
            tier: "growth",
            price_cents: 25000,
            active: true,
          },
        ]);
      }
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }
      if (table === "payments") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            }),
          }),
        };
      }
      return undefined;
    });
  });

  it("returns 401 if user is not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    const req = createMockRequest({ planId: "123" });
    const res = await createCheckout(req);

    expect(res.status).toBe(401);
  });

  it("rejects cross-site checkout creation requests", async () => {
    const res = await createCheckout(
      createCrossSiteRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" })
    );

    expect(res.status).toBe(403);
  });

  it("rejects checkout creation when the CSRF token is missing", async () => {
    const res = await createCheckout(
      createMissingCsrfRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" })
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 cleanly instead of crashing when profile is not found", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }), // Profile not found
        };
      }
    });

    const req = createMockRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" });
    const res = await createCheckout(req);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe("Account profile not found");
  });

  it("returns 404 cleanly instead of crashing when plan is not found", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
        };
      }
      if (table === "plans") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }), // Plan not found
        };
      }
    });

    const req = createMockRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" });
    const res = await createCheckout(req);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe("Plan not found or inactive");
  });

  it("returns 400 for an invalid checkout payload", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const req = createMockRequest({ planId: "not-a-uuid" });
    const res = await createCheckout(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data).toEqual({ error: "Invalid checkout request" });
  });

  it("happy path: returns checkoutUrl and paymentId on success", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "member@test.com" } },
    });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "profile-1", display_name: "Test Account" },
          }),
        };
      }
      if (table === "plans") {
        return createPlansTableMock([
          {
            id: "550e8400-e29b-41d4-a716-446655440000",
            name: "Mzansi Market Growth",
            area: "MZANSI_MARKET",
            tier: "growth",
            price_cents: 25000,
            active: true,
          },
        ]);
      }
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }), // No active entitlement
        };
      }
      if (table === "payments") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "pay-001" },
                error: null,
              }),
            }),
          }),
        };
      }
    });

    const req = createMockRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" });
    const res = await createCheckout(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.checkoutUrl).toBeDefined();
    expect(data.checkoutUrl).toContain("ozow");
    expect(data.paymentId).toBe("pay-001");
    expect(vi.mocked(createHostedCheckout)).toHaveBeenCalledWith(
      expect.objectContaining({
        providerData: expect.objectContaining({
          plan_id: "550e8400-e29b-41d4-a716-446655440000",
        }),
      })
    );
  });

  it("resolves stable frontend plan tokens to the canonical database plan id", async () => {
    const canonicalPlanId = "d76308c6-1e2c-4035-b4f9-7ae40c62125d";
    const stablePlanToken = getStablePlanId("MZANSI_MARKET", "growth");

    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "member@test.com" } },
    });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "profile-1", display_name: "Test Account" },
          }),
        };
      }
      if (table === "plans") {
        return createPlansTableMock(
          [
            {
              id: canonicalPlanId,
              name: "Mzansi Market Growth",
              area: "MZANSI_MARKET",
              tier: "growth",
              price_cents: 25000,
              active: true,
            },
          ],
          { requireDirectIdMiss: true }
        );
      }
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }
      if (table === "payments") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            }),
          }),
        };
      }
    });

    const req = createMockRequest({ planId: stablePlanToken });
    const res = await createCheckout(req);
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

  it("returns 503 when Ozow credentials are missing", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    vi.mocked(createHostedCheckout).mockRejectedValueOnce(
      new OzowConfigurationError("Ozow credentials are not configured")
    );

    const req = createMockRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" });
    const res = await createCheckout(req);
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toBe("Payment processing is not yet configured. Please try again later.");
  });

  it("returns 503 when Ozow authentication fails", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    vi.mocked(createHostedCheckout).mockRejectedValueOnce(
      new OzowAuthenticationError("Payment provider authentication failed")
    );

    const req = createMockRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" });
    const res = await createCheckout(req);
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toBe(
      "Payment provider authentication failed. This is a temporary issue — please try again in a few minutes."
    );
  });

  it("returns 503 when Ozow is temporarily unavailable", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    vi.mocked(createHostedCheckout).mockRejectedValueOnce(
      new OzowProviderError("Ozow payment creation failed")
    );

    const req = createMockRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" });
    const res = await createCheckout(req);
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toBe(
      "Payment provider is temporarily unavailable. Please try again in a few minutes."
    );
  });

  it("returns 429 when rate-limited", async () => {
    const { checkRateLimit } = await import("@/lib/utils/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      limited: true,
      degraded: false,
      retryAfter: 30,
    });
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const res = await createCheckout(
      createMockRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("returns 503 when rate limiter is degraded", async () => {
    const { checkRateLimit } = await import("@/lib/utils/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      limited: true,
      degraded: true,
      retryAfter: 60,
    });
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const res = await createCheckout(
      createMockRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" })
    );

    expect(res.status).toBe(503);
  });

  it("returns 400 when user already has an active entitlement for the area", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "profile-1", display_name: "Test Account" },
          }),
        };
      }
      if (table === "plans") {
        return createPlansTableMock([
          {
            id: "550e8400-e29b-41d4-a716-446655440000",
            name: "Mzansi Market Growth",
            area: "MZANSI_MARKET",
            tier: "growth",
            price_cents: 25000,
            active: true,
          },
        ]);
      }
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "ent-active" } }),
        };
      }
    });

    const res = await createCheckout(
      createMockRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" })
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("already have an active subscription");
  });

  it("returns 409 when a pending payment already exists for the area", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "profile-1", display_name: "Test Account" },
          }),
        };
      }
      if (table === "plans") {
        return createPlansTableMock([
          {
            id: "550e8400-e29b-41d4-a716-446655440000",
            name: "Mzansi Market Growth",
            area: "MZANSI_MARKET",
            tier: "growth",
            price_cents: 25000,
            active: true,
          },
        ]);
      }
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }
      if (table === "payments") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "pay-pending" } }),
                }),
              }),
            }),
          }),
        };
      }
    });

    const res = await createCheckout(
      createMockRequest({ planId: "550e8400-e29b-41d4-a716-446655440000" })
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toContain("pending payment");
  });
});

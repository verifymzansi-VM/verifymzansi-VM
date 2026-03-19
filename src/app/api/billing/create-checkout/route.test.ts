import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as createCheckout } from "@/app/api/billing/create-checkout/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type NextRequest } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

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

function createMockRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
    json: async () => body,
    url: "https://verifymzansi.com/api/billing/create-checkout",
    headers: new Headers({
      origin: "https://verifymzansi.com",
      cookie: `vm_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    }),
  } as unknown as NextRequest;
}

function createCrossSiteRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
    json: async () => body,
    url: "https://verifymzansi.com/api/billing/create-checkout",
    headers: new Headers({
      origin: "https://evil.example",
      cookie: `vm_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    }),
  } as unknown as NextRequest;
}

function createMissingCsrfRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
    json: async () => body,
    url: "https://verifymzansi.com/api/billing/create-checkout",
    headers: new Headers({ origin: "https://verifymzansi.com" }),
  } as unknown as NextRequest;
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "550e8400-e29b-41d4-a716-446655440000",
              name: "Mzansi Market Growth",
              area: "MZANSI_MARKET",
              tier: "growth",
              price_cents: 25000,
              active: true,
            },
          }),
        };
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
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: "pay-001" },
            error: null,
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
  });
});

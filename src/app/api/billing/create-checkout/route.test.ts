import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as createCheckout } from "@/app/api/billing/create-checkout/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => {
    const envMap: Record<string, string> = {
      NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
      PAYFAST_MERCHANT_ID: "test-merchant-id",
      PAYFAST_MERCHANT_KEY: "test-merchant-key",
      PAYFAST_NOTIFY_URL: "https://verifymzansi.com/api/webhooks/payfast",
      PAYFAST_PASSPHRASE: "test-passphrase", // secret-scan: allow
      NODE_ENV: "development",
      PAYFAST_SANDBOX: "true",
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
  } as unknown as NextRequest;
}

describe("POST /api/billing/create-checkout", () => {
  const mockSupabase = {
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

  it("returns 401 if user is not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    const req = createMockRequest({ planId: "123" });
    const res = await createCheckout(req);

    expect(res.status).toBe(401);
  });

  it("returns 404 cleanly instead of crashing when profile is not found", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
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
    expect(data.error).toBe("Seller profile not found");
  });

  it("returns 404 cleanly instead of crashing when plan is not found", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
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
      data: { user: { id: "user-1", email: "seller@test.com" } },
    });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "profile-1", display_name: "Test Seller" },
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
    expect(data.checkoutUrl).toContain("merchant_id");
    expect(data.paymentId).toBe("pay-001");
  });
});

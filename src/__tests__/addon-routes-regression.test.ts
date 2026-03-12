/**
 * Regression tests for the "Feature listing checkout broken" incident.
 *
 * Root cause: /api/listings/[id]/featured and /api/listings/[id]/urgent
 * were not included in the production build. These tests verify:
 *
 * 1. Route files exist and export POST handlers.
 * 2. PayFast env-missing path returns 503 (billing not configured).
 * 3. Payment insert failure returns 500 (not a crash).
 * 4. Audit log failure doesn't crash the checkout flow.
 * 5. Concurrent "already active" guard is tested.
 *
 * These scenarios were previously missing from the test suite.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ── Hoisted mocks ──────────────────────────────────────────────
const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent, mockEnv } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockEnv: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/config/env", () => ({
  env: (...args: unknown[]) => mockEnv(...args),
}));
vi.mock("@/lib/services/payfast", () => ({
  buildPayFastCheckoutUrl: vi.fn().mockReturnValue("https://payfast.co.za/checkout"),
}));
vi.mock("@/lib/services/entitlements", () => ({
  canFeatured: vi.fn().mockReturnValue({ allowed: true }),
  canUrgent: vi.fn().mockReturnValue({ allowed: true }),
  canBoost: vi.fn().mockReturnValue({ allowed: true }),
}));
vi.mock("@/lib/services/plan-tier", () => ({
  getActivePlanTierForArea: vi.fn().mockResolvedValue("pro"),
}));
vi.mock("@/lib/constants/pricing", () => ({
  ADDON_PRICES: { boost: 1500, featured: 2500, urgent: 1000 },
  BOOST_DURATION_DAYS: 7,
  FEATURED_DURATION_DAYS: 7,
  URGENT_DURATION_DAYS: 7,
}));

// ── Import route handlers ──────────────────────────────────────
import { POST as FeaturedPOST } from "@/app/api/listings/[id]/featured/route";
import { POST as UrgentPOST } from "@/app/api/listings/[id]/urgent/route";
import { POST as BoostPOST } from "@/app/api/listings/[id]/boost/route";

// ── Helpers ────────────────────────────────────────────────────
const UUID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "user-1";

function createRequest(): NextRequest {
  return {
    method: "POST",
    json: async () => ({}),
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL("http://localhost:3000/api/listings/test/featured"),
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
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    single: vi.fn().mockResolvedValue({ data: { id: "payment-1" }, error: null }),
    insert: vi.fn().mockReturnThis(),
    ...(tableOverrides[table] || {}),
  });
  mockCreateAdminClient.mockReturnValue({
    from: vi.fn((table: string) => makeChain(table)),
  });
}

function setupHappyPath(addonField: "featured_until" | "boost_until" | "urgent_until") {
  mockAuth({ id: USER_ID, email: "seller@test.com" });
  mockAdmin({
    account_profiles: {
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
    },
    listings: {
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: UUID,
          title: "Test Listing",
          status: "live",
          area: "MZANSI_MARKET",
          owner_id: USER_ID,
          [addonField]: null,
        },
      }),
    },
    payments: {
      single: vi.fn().mockResolvedValue({ data: { id: "payment-1" }, error: null }),
    },
  });
}

function setupEnvWithPayFast() {
  mockEnv.mockImplementation((key: string) => {
    const envMap: Record<string, string> = {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      PAYFAST_MERCHANT_ID: "test-merchant-id",
      PAYFAST_MERCHANT_KEY: "test-merchant-key",
      PAYFAST_NOTIFY_URL: "http://localhost:3000/api/webhooks/payfast",
    };
    return envMap[key] ?? "";
  });
}

function setupEnvWithoutPayFast() {
  mockEnv.mockImplementation((key: string) => {
    const envMap: Record<string, string> = {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      PAYFAST_MERCHANT_ID: "", // Missing!
      PAYFAST_MERCHANT_KEY: "", // Missing!
      PAYFAST_NOTIFY_URL: "http://localhost:3000/api/webhooks/payfast",
    };
    return envMap[key] ?? "";
  });
}

// ── Test 1: Route module exports ───────────────────────────────

describe("Route module exports (regression: routes excluded from build)", () => {
  it("featured route exports a POST handler", () => {
    expect(typeof FeaturedPOST).toBe("function");
  });

  it("urgent route exports a POST handler", () => {
    expect(typeof UrgentPOST).toBe("function");
  });

  it("boost route exports a POST handler", () => {
    expect(typeof BoostPOST).toBe("function");
  });
});

// ── Test 2: 503 when PayFast billing not configured ────────────

describe("Billing not configured (PAYFAST_MERCHANT_ID/KEY missing)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("featured returns 503 when merchant credentials are empty", async () => {
    setupHappyPath("featured_until");
    setupEnvWithoutPayFast();

    const req = createRequest();
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Billing is not yet configured");
  });

  it("urgent returns 503 when merchant credentials are empty", async () => {
    setupHappyPath("urgent_until");
    setupEnvWithoutPayFast();

    const req = createRequest();
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Billing is not yet configured");
  });

  it("boost returns 503 when merchant credentials are empty", async () => {
    setupHappyPath("boost_until");
    setupEnvWithoutPayFast();

    const req = createRequest();
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Billing is not yet configured");
  });
});

// ── Test 3: Payment DB insert failure ──────────────────────────

describe("Payment insert failure path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("featured returns 500 when payment creation fails with DB error", async () => {
    mockAuth({ id: USER_ID, email: "seller@test.com" });
    setupEnvWithPayFast();
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
      listings: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: UUID,
            title: "Test",
            status: "live",
            area: "MZANSI_MARKET",
            owner_id: USER_ID,
            featured_until: null,
          },
        }),
      },
      payments: {
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "DB connection lost", code: "PGRST301" },
        }),
      },
    });

    const req = createRequest();
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to create payment");
  });
});

// ── Test 4: Audit log failure doesn't crash checkout ───────────

describe("Audit log failure resilience", () => {
  beforeEach(() => vi.clearAllMocks());

  it("featured checkout succeeds even when audit log throws (audit is non-fatal)", async () => {
    setupHappyPath("featured_until");
    setupEnvWithPayFast();
    mockLogAuditEvent.mockRejectedValueOnce(new Error("Audit service down"));

    const req = createRequest();
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });

    // Audit failure is caught internally — checkout still succeeds
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkoutUrl).toBeDefined();
  });

  it("boost checkout succeeds even when audit log throws", async () => {
    setupHappyPath("boost_until");
    setupEnvWithPayFast();
    mockLogAuditEvent.mockRejectedValueOnce(new Error("Audit service down"));

    const req = createRequest();
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("urgent checkout succeeds even when audit log throws", async () => {
    setupHappyPath("urgent_until");
    setupEnvWithPayFast();
    mockLogAuditEvent.mockRejectedValueOnce(new Error("Audit service down"));

    const req = createRequest();
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

// ── Test 5: Already-active with future date edge case ──────────

describe("Already-active guard edge cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("featured allows re-purchase when featured_until is in the past", async () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    mockAuth({ id: USER_ID, email: "seller@test.com" });
    setupEnvWithPayFast();
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
      listings: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: UUID,
            title: "Test",
            status: "live",
            area: "MZANSI_MARKET",
            owner_id: USER_ID,
            featured_until: pastDate, // Expired
          },
        }),
      },
      payments: {
        single: vi.fn().mockResolvedValue({ data: { id: "pay-1" }, error: null }),
      },
    });

    const req = createRequest();
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkoutUrl).toBeDefined();
  });

  it("featured blocks re-purchase when featured_until is 1 second in the future", async () => {
    const nearFutureDate = new Date(Date.now() + 1000).toISOString();
    mockAuth({ id: USER_ID, email: "seller@test.com" });
    setupEnvWithPayFast();
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
      listings: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: UUID,
            title: "Test",
            status: "live",
            area: "MZANSI_MARKET",
            owner_id: USER_ID,
            featured_until: nearFutureDate, // Still active
          },
        }),
      },
    });

    const req = createRequest();
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("This listing is already featured");
  });
});

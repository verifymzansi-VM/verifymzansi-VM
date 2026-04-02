/**
 * Regression tests for the "Feature listing checkout broken" incident.
 *
 * Root cause: /api/listings/[id]/featured and /api/listings/[id]/urgent
 * were not included in the production build. These tests verify:
 *
 * 1. Route files exist and export POST handlers.
 * 2. Billing-misconfigured path fails safely instead of crashing.
 * 3. Payment insert failure returns 500 (not a crash).
 * 4. Audit log failure doesn't crash the checkout flow.
 * 5. Concurrent "already active" guard is tested.
 *
 * These scenarios were previously missing from the test suite.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { resetOwnerColumnCacheForTesting } from "@/lib/account/compat";

// ── Hoisted mocks ──────────────────────────────────────────────
const {
  mockCreateClient,
  mockCreateAdminClient,
  mockLogAuditEvent,
  mockEnv,
  mockClientFrom,
  mockCheckLocalRateLimit,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockEnv: vi.fn(),
  mockClientFrom: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
}));
const mockCreateHostedCheckout = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/config/env", () => ({
  env: (...args: unknown[]) => mockEnv(...args),
}));
vi.mock("@/lib/payments/checkout", () => ({
  createHostedCheckout: (...args: unknown[]) => mockCreateHostedCheckout(...args),
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
vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
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

function mockListingRow(row: Record<string, unknown> | null) {
  mockClientFrom.mockImplementation((table: string) => {
    if (table === "listings") {
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

function setupHappyPath(addonField: "featured_until" | "boost_until" | "urgent_until") {
  mockAuth({ id: USER_ID, email: "seller@test.com" });
  mockListingRow({
    id: UUID,
    title: "Test Listing",
    status: "live",
    area: "MZANSI_MARKET",
    owner_id: USER_ID,
    [addonField]: null,
  });
  mockCreateHostedCheckout.mockResolvedValue({
    paymentId: "payment-1",
    checkoutUrl: "https://pay.ozow.test/checkout",
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

function setupEnvWithOzow() {
  mockEnv.mockImplementation((key: string) => {
    const envMap: Record<string, string> = {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      OZOW_ENV: "staging",
    };
    return envMap[key] ?? "";
  });
}

function setupEnvWithoutOzow() {
  mockEnv.mockImplementation((key: string) => {
    const envMap: Record<string, string> = {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      OZOW_ENV: "",
    };
    return envMap[key] ?? "";
  });
  mockCreateHostedCheckout.mockRejectedValue(new Error("Ozow credentials are not configured"));
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

// ── Test 2: billing misconfiguration fails safely ──────────────

describe("Billing not configured", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
  });

  it("featured fails safely when Ozow credentials are missing", async () => {
    setupHappyPath("featured_until");
    setupEnvWithoutOzow();

    const req = createRequest();
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect([500, 503]).toContain(res.status);
    const body = await res.json();
    expect(body.error).toMatch(/billing|checkout/i);
  });

  it("urgent fails safely when Ozow credentials are missing", async () => {
    setupHappyPath("urgent_until");
    setupEnvWithoutOzow();

    const req = createRequest();
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect([500, 503]).toContain(res.status);
    const body = await res.json();
    expect(body.error).toMatch(/billing|checkout/i);
  });

  it("boost fails safely when Ozow credentials are missing", async () => {
    setupHappyPath("boost_until");
    setupEnvWithoutOzow();

    const req = createRequest();
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect([500, 503]).toContain(res.status);
    const body = await res.json();
    expect(body.error).toMatch(/billing|checkout/i);
  });
});

// ── Test 3: Payment DB insert failure ──────────────────────────

describe("Payment insert failure path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
  });

  it("featured returns 500 when payment creation fails with DB error", async () => {
    mockAuth({ id: USER_ID, email: "seller@test.com" });
    mockListingRow({
      id: UUID,
      title: "Test",
      status: "live",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      featured_until: null,
    });
    setupEnvWithOzow();
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
    });
    mockCreateHostedCheckout.mockRejectedValueOnce(new Error("Failed to create payment"));

    const req = createRequest();
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to create featured checkout");
  });
});

// ── Test 4: Audit log failure doesn't crash checkout ───────────

describe("Audit log failure resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
  });

  it("featured checkout succeeds even when audit log throws (audit is non-fatal)", async () => {
    setupHappyPath("featured_until");
    setupEnvWithOzow();
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
    setupEnvWithOzow();
    mockLogAuditEvent.mockRejectedValueOnce(new Error("Audit service down"));

    const req = createRequest();
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("urgent checkout succeeds even when audit log throws", async () => {
    setupHappyPath("urgent_until");
    setupEnvWithOzow();
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
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
  });

  it("featured allows re-purchase when featured_until is in the past", async () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    mockAuth({ id: USER_ID, email: "seller@test.com" });
    mockListingRow({
      id: UUID,
      title: "Test",
      status: "live",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      featured_until: pastDate,
    });
    setupEnvWithOzow();
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
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
    mockListingRow({
      id: UUID,
      title: "Test",
      status: "live",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      featured_until: nearFutureDate,
    });
    setupEnvWithOzow();
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
    });

    const req = createRequest();
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("This listing is already featured");
  });
});

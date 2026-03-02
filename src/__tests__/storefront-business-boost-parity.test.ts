/**
 * Route parity tests — storefront & business-ads boost routes.
 *
 * Audit finding M6: storefront and business-ads boost routes had no dedicated
 * test file. They mirror the listing boost route but target different tables
 * (storefronts, business_profiles) and areas (MALL_SHOPS, BUSINESS_ADS).
 *
 * These tests verify the same validation pipeline: UUID → auth → seller lookup →
 * entity lookup → ownership → live-status → already-boosted → entitlement →
 * payment → checkout URL → audit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock all external dependencies ────────────────────────────

const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
  }),
}));

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockFrom(...args),
  })),
}));

const mockBuildPayFastCheckoutUrl = vi.fn().mockReturnValue("https://payfast.test/checkout");
vi.mock("@/lib/services/payfast", () => ({
  buildPayFastCheckoutUrl: (...args: unknown[]) => mockBuildPayFastCheckoutUrl(...args),
}));

const mockCanBoost = vi.fn().mockReturnValue({ allowed: true });
vi.mock("@/lib/services/entitlements", () => ({
  canBoost: (...args: unknown[]) => mockCanBoost(...args),
}));

const mockLogAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
}));

vi.mock("@/lib/constants/pricing", () => ({
  ADDON_PRICES: { boost: 1500, featured: 2500, urgent: 1000 },
  BOOST_DURATION_DAYS: 7,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => {
    const envMap: Record<string, string> = {
      NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
      PAYFAST_MERCHANT_ID: "test-merchant-id",
      PAYFAST_MERCHANT_KEY: "test-merchant-key",
      PAYFAST_NOTIFY_URL: "https://verifymzansi.com/api/webhooks/payfast",
    };
    return envMap[key] ?? "";
  }),
}));

const mockGetActivePlanTierForArea = vi.fn().mockResolvedValue("pro");
vi.mock("@/lib/services/plan-tier", () => ({
  getActivePlanTierForArea: (...args: unknown[]) => mockGetActivePlanTierForArea(...args),
}));

// ── Import route handlers (after mocks) ───────────────────────

import { POST as storefrontBoostPOST } from "@/app/api/storefronts/[id]/boost/route";
import { POST as businessBoostPOST } from "@/app/api/business-ads/[id]/boost/route";

// ── Helpers ───────────────────────────────────────────────────

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER_ID = "user-0001-0001-0001-000000000001";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/test", { method: "POST" });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

interface RouteSetup {
  name: string;
  handler: typeof storefrontBoostPOST;
  entityTable: string;
  entityKey: string;
  entityData: Record<string, unknown>;
  idLabel: string;
  ownershipError: string;
  statusError: string;
  alreadyBoostedError: string;
  expectedAuditAction: string;
  expectedAuditArea: string;
  expectedAuditTargetType: string;
}

const ROUTES: RouteSetup[] = [
  {
    name: "storefront boost",
    handler: storefrontBoostPOST,
    entityTable: "storefronts",
    entityKey: "mall_name",
    entityData: {
      id: VALID_UUID,
      mall_name: "Test Mall Shop",
      status: "live",
      seller_id: USER_ID,
      boost_until: null,
    },
    idLabel: "storefront",
    ownershipError: "You don't own this storefront",
    statusError: "Only live storefronts can be boosted",
    alreadyBoostedError: "This storefront is already boosted",
    expectedAuditAction: "storefront_boosted",
    expectedAuditArea: "MALL_SHOPS",
    expectedAuditTargetType: "storefront",
  },
  {
    name: "business-ads boost",
    handler: businessBoostPOST,
    entityTable: "business_profiles",
    entityKey: "business_name",
    entityData: {
      id: VALID_UUID,
      business_name: "Test Business",
      status: "live",
      seller_id: USER_ID,
      boost_until: null,
    },
    idLabel: "profile",
    ownershipError: "You don't own this profile",
    statusError: "Only live profiles can be boosted",
    alreadyBoostedError: "This profile is already boosted",
    expectedAuditAction: "business_boosted",
    expectedAuditArea: "BUSINESS_ADS",
    expectedAuditTargetType: "business_profile",
  },
];

function setupHappyPath(route: RouteSetup) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: USER_ID, email: "seller@test.com" } },
  });

  const sellerProfileBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
  };

  const entityBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { ...route.entityData },
    }),
  };

  const paymentBuilder = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "pay-001" }, error: null }),
  };

  mockFrom.mockImplementation((table: string) => {
    if (table === "seller_profiles") return sellerProfileBuilder;
    if (table === route.entityTable) return entityBuilder;
    if (table === "payments") return paymentBuilder;
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
  });
}

// ── Tests ─────────────────────────────────────────────────────

describe.each(ROUTES)("POST /api/$name", (route) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── UUID Validation ──────────────────────────────────────

  it("returns 400 for malformed ID", async () => {
    setupHappyPath(route);
    const res = await route.handler(makeRequest(), makeParams("not-a-uuid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid");
  });

  // ── Auth ─────────────────────────────────────────────────

  it("returns 401 for unauthenticated requests", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(401);
  });

  // ── Seller Profile ──────────────────────────────────────

  it("returns 404 when seller profile not found", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "seller@test.com" } },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    });

    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Seller profile not found");
  });

  // ── Entity Not Found ────────────────────────────────────

  it("returns 404 when entity not found", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "seller@test.com" } },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
        };
      }
      if (table === route.entityTable) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    });

    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
  });

  // ── Ownership ───────────────────────────────────────────

  it("returns 403 when user doesn't own the entity", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "seller@test.com" } },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
        };
      }
      if (table === route.entityTable) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              ...route.entityData,
              seller_id: "another-user", // different owner
            },
          }),
        };
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    });

    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(route.ownershipError);
  });

  // ── Status Guards ───────────────────────────────────────

  it("returns 400 when entity is not live", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "seller@test.com" } },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
        };
      }
      if (table === route.entityTable) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { ...route.entityData, status: "draft" },
          }),
        };
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    });

    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(route.statusError);
  });

  // ── Already Boosted ─────────────────────────────────────

  it("returns 400 when entity is already boosted", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "seller@test.com" } },
    });

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
        };
      }
      if (table === route.entityTable) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { ...route.entityData, boost_until: futureDate },
          }),
        };
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    });

    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(route.alreadyBoostedError);
  });

  // ── Entitlement Gating ──────────────────────────────────

  it("returns 403 when plan does not allow boost", async () => {
    setupHappyPath(route);
    mockCanBoost.mockReturnValue({
      allowed: false,
      reason: "Boost is not available on your plan.",
    });

    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Boost");
  });

  // ── Billing Not Configured ──────────────────────────────

  it("returns 503 when billing is not configured", async () => {
    setupHappyPath(route);
    mockCanBoost.mockReturnValue({ allowed: true });

    // Override env to remove merchant credentials
    const { env } = await import("@/lib/config/env");
    const mockEnv = vi.mocked(env);
    mockEnv.mockImplementation((key: string) => {
      if (key === "PAYFAST_MERCHANT_ID") return "";
      if (key === "PAYFAST_MERCHANT_KEY") return "";
      const defaults: Record<string, string> = {
        NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
        PAYFAST_NOTIFY_URL: "https://verifymzansi.com/api/webhooks/payfast",
      };
      return defaults[key] ?? "";
    });

    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Billing");
  });

  // ── Happy Path ──────────────────────────────────────────

  it("returns 200 with checkout URL on happy path", async () => {
    // Re-establish env mock (may have been overridden by billing test)
    const { env } = await import("@/lib/config/env");
    vi.mocked(env).mockImplementation((key: string) => {
      const defaults: Record<string, string> = {
        NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
        PAYFAST_MERCHANT_ID: "test-merchant-id",
        PAYFAST_MERCHANT_KEY: "test-merchant-key",
        PAYFAST_NOTIFY_URL: "https://verifymzansi.com/api/webhooks/payfast",
      };
      return defaults[key] ?? "";
    });

    setupHappyPath(route);
    mockCanBoost.mockReturnValue({ allowed: true });

    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkoutUrl).toContain("payfast");
    expect(body.paymentId).toBeDefined();
  });

  // ── Payment Creation Failure ────────────────────────────

  it("returns 500 when payment insert fails", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "seller@test.com" } },
    });
    mockCanBoost.mockReturnValue({ allowed: true });

    const failingPaymentBuilder = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "DB error" },
      }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
        };
      }
      if (table === route.entityTable) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { ...route.entityData },
          }),
        };
      }
      if (table === "payments") return failingPaymentBuilder;
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    });

    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("payment");
  });

  // ── Audit action correctness (regression for copy-paste bug) ──

  it("logs correct audit action and area on happy path", async () => {
    const { env } = await import("@/lib/config/env");
    vi.mocked(env).mockImplementation((key: string) => {
      const defaults: Record<string, string> = {
        NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
        PAYFAST_MERCHANT_ID: "test-merchant-id",
        PAYFAST_MERCHANT_KEY: "test-merchant-key",
        PAYFAST_NOTIFY_URL: "https://verifymzansi.com/api/webhooks/payfast",
      };
      return defaults[key] ?? "";
    });

    setupHappyPath(route);
    mockCanBoost.mockReturnValue({ allowed: true });

    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);

    // Verify correct audit action (NOT "listing_boosted")
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: route.expectedAuditAction,
        targetType: route.expectedAuditTargetType,
        area: route.expectedAuditArea,
      })
    );
  });

  // ── Audit resilience ────────────────────────────────────

  it("returns 200 even when audit logging fails", async () => {
    // Re-establish env mock (may have been overridden by billing test)
    const { env } = await import("@/lib/config/env");
    vi.mocked(env).mockImplementation((key: string) => {
      const defaults: Record<string, string> = {
        NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
        PAYFAST_MERCHANT_ID: "test-merchant-id",
        PAYFAST_MERCHANT_KEY: "test-merchant-key",
        PAYFAST_NOTIFY_URL: "https://verifymzansi.com/api/webhooks/payfast",
      };
      return defaults[key] ?? "";
    });

    setupHappyPath(route);
    mockCanBoost.mockReturnValue({ allowed: true });
    mockLogAuditEvent.mockRejectedValueOnce(new Error("Audit DB down"));

    const res = await route.handler(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

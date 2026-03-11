/**
 * Unit tests for the listing addon checkout routes:
 *   POST /api/listings/[id]/featured
 *   POST /api/listings/[id]/boost
 *   POST /api/listings/[id]/urgent
 *
 * Tests cover: UUID validation, auth, ownership, status guards,
 * already-active guard, entitlement gating, payment creation,
 * amount conversion (cents→ZAR), audit area casing, and happy path.
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

const mockCanFeatured = vi.fn().mockReturnValue({ allowed: true });
const mockCanBoost = vi.fn().mockReturnValue({ allowed: true });
const mockCanUrgent = vi.fn().mockReturnValue({ allowed: true });
vi.mock("@/lib/services/entitlements", () => ({
  canFeatured: (...args: unknown[]) => mockCanFeatured(...args),
  canBoost: (...args: unknown[]) => mockCanBoost(...args),
  canUrgent: (...args: unknown[]) => mockCanUrgent(...args),
}));

const mockLogAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
}));

vi.mock("@/lib/constants/pricing", () => ({
  ADDON_PRICES: { boost: 1500, featured: 2500, urgent: 1000 },
  BOOST_DURATION_DAYS: 7,
  FEATURED_DURATION_DAYS: 7,
  URGENT_DURATION_DAYS: 7,
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

// ── Import route handlers (after mocks are set up) ────────────

import { POST as featuredPOST } from "@/app/api/listings/[id]/featured/route";
import { POST as boostPOST } from "@/app/api/listings/[id]/boost/route";
import { POST as urgentPOST } from "@/app/api/listings/[id]/urgent/route";

// ── Helpers ───────────────────────────────────────────────────

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER_ID = "user-0001-0001-0001-000000000001";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/listings/test/featured", { method: "POST" });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Set up the standard happy-path mocks for a given addon type */
function setupHappyPath(addonField: "featured_until" | "boost_until" | "urgent_until") {
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: "seller@test.com" } } });

  const sellerProfileBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
  };

  const listingBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: VALID_UUID,
        title: "Test Listing",
        status: "live",
        area: "MZANSI_MARKET",
        seller_id: USER_ID,
        [addonField]: null,
      },
    }),
  };

  const paymentBuilder = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "pay-001" }, error: null }),
  };

  mockFrom.mockImplementation((table: string) => {
    if (table === "seller_profiles") return sellerProfileBuilder;
    if (table === "listings") return listingBuilder;
    if (table === "payments") return paymentBuilder;
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
  });
}

// ── Tests ─────────────────────────────────────────────────────

describe.each([
  { name: "featured", handler: () => featuredPOST, addonField: "featured_until" as const },
  { name: "boost", handler: () => boostPOST, addonField: "boost_until" as const },
  { name: "urgent", handler: () => urgentPOST, addonField: "urgent_until" as const },
])("POST /api/listings/[id]/$name", ({ name, handler, addonField }) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for malformed listing ID", async () => {
    setupHappyPath(addonField);
    const res = await handler()(makeRequest(), makeParams("not-a-uuid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid listing ID");
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await handler()(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when account profile is not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: "a@b.com" } } });

    const sellerProfileBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") return sellerProfileBuilder;
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    });

    const res = await handler()(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Account profile not found");
  });

  it("returns 403 when user does not own the listing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: "a@b.com" } } });

    const sellerProfileBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
    };
    const listingBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: VALID_UUID,
          title: "Other Listing",
          status: "live",
          area: "MZANSI_MARKET",
          seller_id: "different-user-id",
          [addonField]: null,
        },
      }),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") return sellerProfileBuilder;
      if (table === "listings") return listingBuilder;
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    });

    const res = await handler()(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("don't own");
  });

  it("returns 400 when listing is not live", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: "a@b.com" } } });

    const sellerProfileBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
    };
    const listingBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: VALID_UUID,
          title: "Draft Listing",
          status: "draft",
          area: "MZANSI_MARKET",
          seller_id: USER_ID,
          [addonField]: null,
        },
      }),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") return sellerProfileBuilder;
      if (table === "listings") return listingBuilder;
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    });

    const res = await handler()(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/only live listings/i);
  });

  it("returns 400 when addon is already active", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID, email: "a@b.com" } } });

    // Set expiry to the future
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const sellerProfileBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
    };
    const listingBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: VALID_UUID,
          title: "Active Listing",
          status: "live",
          area: "MZANSI_MARKET",
          seller_id: USER_ID,
          [addonField]: futureDate,
        },
      }),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") return sellerProfileBuilder;
      if (table === "listings") return listingBuilder;
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    });

    const res = await handler()(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already/i);
  });

  it("returns 403 when entitlement check fails", async () => {
    setupHappyPath(addonField);

    const canMock =
      name === "featured" ? mockCanFeatured : name === "boost" ? mockCanBoost : mockCanUrgent;

    canMock.mockReturnValue({ allowed: false, reason: "Upgrade required" });

    const res = await handler()(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Upgrade required");
  });

  it("happy path: returns checkout URL and payment ID", async () => {
    setupHappyPath(addonField);
    mockCanFeatured.mockReturnValue({ allowed: true });
    mockCanBoost.mockReturnValue({ allowed: true });
    mockCanUrgent.mockReturnValue({ allowed: true });

    const res = await handler()(makeRequest(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.checkoutUrl).toBe("https://payfast.test/checkout");
    expect(body.paymentId).toBe("pay-001");
  });

  it("passes amount in ZAR (cents ÷ 100) to PayFast", async () => {
    setupHappyPath(addonField);
    mockCanFeatured.mockReturnValue({ allowed: true });
    mockCanBoost.mockReturnValue({ allowed: true });
    mockCanUrgent.mockReturnValue({ allowed: true });

    await handler()(makeRequest(), makeParams(VALID_UUID));

    expect(mockBuildPayFastCheckoutUrl).toHaveBeenCalledTimes(1);
    const passedParams = mockBuildPayFastCheckoutUrl.mock.calls[0][0];

    // Verify amount is in ZAR, not cents
    const expectedAmounts: Record<string, number> = {
      featured: 25, // 2500 / 100
      boost: 15, // 1500 / 100
      urgent: 10, // 1000 / 100
    };
    expect(passedParams.amount).toBe(expectedAmounts[name]);
  });

  it("includes uppercase area in audit log (matches DB enum)", async () => {
    setupHappyPath(addonField);
    mockCanFeatured.mockReturnValue({ allowed: true });
    mockCanBoost.mockReturnValue({ allowed: true });
    mockCanUrgent.mockReturnValue({ allowed: true });

    await handler()(makeRequest(), makeParams(VALID_UUID));

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const auditEntry = mockLogAuditEvent.mock.calls[0][0];

    // area must match the DB marketplace_area enum (uppercase)
    expect(auditEntry.area).toBe("MZANSI_MARKET");
    expect(auditEntry.actorId).toBe(USER_ID);
    expect(auditEntry.targetId).toBe(VALID_UUID);
  });
});

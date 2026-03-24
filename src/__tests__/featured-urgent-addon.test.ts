import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent, mockClientFrom } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockLogAuditEvent: vi.fn(),
    mockClientFrom: vi.fn(),
  })
);

const mockCreateHostedCheckout = vi.fn().mockResolvedValue({
  paymentId: "payment-1",
  checkoutUrl: "https://pay.ozow.test/checkout",
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
// FIX: env is exported as a function, not an object
vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => {
    const envMap: Record<string, string> = {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      OZOW_ENV: "staging",
    };
    return envMap[key] ?? "";
  }),
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

import { POST as FeaturedPOST } from "@/app/api/listings/[id]/featured/route";
import { POST as UrgentPOST } from "@/app/api/listings/[id]/urgent/route";
import { POST as BoostPOST } from "@/app/api/listings/[id]/boost/route";

function createRequest(url: string, body?: unknown) {
  return {
    method: "POST",
    json: async () => body ?? {},
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL(url, "http://localhost:3000"),
  } as unknown as NextRequest;
}

const UUID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "user-1";

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

// FIX: Per-table mock dispatch instead of a single chain for all tables
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

/** Set up the standard happy-path mocks */
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
  mockAdmin({
    account_profiles: {
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
    },
    payments: {
      single: vi.fn().mockResolvedValue({ data: { id: "payment-1" }, error: null }),
    },
  });
}

// ── Featured ──────────────────────────────────────────────────

describe("POST /api/listings/[id]/featured", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListingRow(null);
    mockCreateHostedCheckout.mockResolvedValue({
      paymentId: "payment-1",
      checkoutUrl: "https://pay.ozow.test/checkout",
    });
  });

  it("rejects invalid UUID", async () => {
    mockAuth({ id: USER_ID });
    const req = createRequest("http://localhost:3000/api/listings/bad/featured");
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: "bad" }) });
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/featured`);
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(401);
  });

  // FIX: This now correctly tests "listing not found" (account profile present, listing absent)
  it("returns 404 when listing not found", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/featured`);
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Listing not found");
  });

  it("returns 404 when account profile not found", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: null }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/featured`);
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Account profile not found");
  });

  it("returns 404 when user does not own listing", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/featured`);
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Listing not found");
  });

  it("returns 400 when listing is not live", async () => {
    mockAuth({ id: USER_ID });
    mockListingRow({
      id: UUID,
      title: "X",
      status: "draft",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      featured_until: null,
    });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/featured`);
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Only live listings can be featured");
  });

  it("returns 400 when already featured", async () => {
    mockAuth({ id: USER_ID });
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    mockListingRow({
      id: UUID,
      title: "X",
      status: "live",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      featured_until: futureDate,
    });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/featured`);
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This listing is already featured");
  });

  it("returns 403 when entitlement denied", async () => {
    const { canFeatured } = await import("@/lib/services/entitlements");
    vi.mocked(canFeatured).mockReturnValueOnce({ allowed: false, reason: "Upgrade required" });
    setupHappyPath("featured_until");
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/featured`);
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Upgrade required");
  });

  it("returns 500 when payment insert fails", async () => {
    mockAuth({ id: USER_ID, email: "seller@test.com" });
    mockListingRow({
      id: UUID,
      title: "Test",
      status: "live",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      featured_until: null,
    });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    mockCreateHostedCheckout.mockRejectedValueOnce(new Error("Checkout provider unavailable"));
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/featured`);
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to create featured checkout");
  });

  it("happy path returns checkout URL", async () => {
    setupHappyPath("featured_until");
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/featured`);
    const res = await FeaturedPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkoutUrl).toBe("https://pay.ozow.test/checkout");
    expect(body.paymentId).toBe("payment-1");
  });
});

// ── Urgent ────────────────────────────────────────────────────

describe("POST /api/listings/[id]/urgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListingRow(null);
    mockCreateHostedCheckout.mockResolvedValue({
      paymentId: "payment-1",
      checkoutUrl: "https://pay.ozow.test/checkout",
    });
  });

  it("rejects invalid UUID", async () => {
    mockAuth({ id: USER_ID });
    const req = createRequest("http://localhost:3000/api/listings/bad/urgent");
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: "bad" }) });
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/urgent`);
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when account profile not found", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: null }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/urgent`);
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Account profile not found");
  });

  it("returns 404 when user does not own listing", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/urgent`);
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Listing not found");
  });

  it("returns 400 when listing is not live", async () => {
    mockAuth({ id: USER_ID });
    mockListingRow({
      id: UUID,
      title: "X",
      status: "draft",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      urgent_until: null,
    });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/urgent`);
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Only live listings can be marked urgent");
  });

  it("returns 400 when already marked urgent", async () => {
    mockAuth({ id: USER_ID });
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    mockListingRow({
      id: UUID,
      title: "X",
      status: "live",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      urgent_until: futureDate,
    });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/urgent`);
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This listing is already marked urgent");
  });

  it("returns 403 when entitlement denied", async () => {
    const { canUrgent } = await import("@/lib/services/entitlements");
    vi.mocked(canUrgent).mockReturnValueOnce({ allowed: false, reason: "Upgrade required" });
    setupHappyPath("urgent_until");
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/urgent`);
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Upgrade required");
  });

  it("returns 500 when payment insert fails", async () => {
    mockAuth({ id: USER_ID, email: "seller@test.com" });
    mockListingRow({
      id: UUID,
      title: "Test",
      status: "live",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      urgent_until: null,
    });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    mockCreateHostedCheckout.mockRejectedValueOnce(new Error("Checkout provider unavailable"));
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/urgent`);
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to create urgent checkout");
  });

  it("happy path returns checkout URL", async () => {
    setupHappyPath("urgent_until");
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/urgent`);
    const res = await UrgentPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkoutUrl).toBe("https://pay.ozow.test/checkout");
    expect(body.paymentId).toBe("payment-1");
  });
});

// ── Boost (NEW — previously untested) ─────────────────────────

describe("POST /api/listings/[id]/boost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListingRow(null);
    mockCreateHostedCheckout.mockResolvedValue({
      paymentId: "payment-1",
      checkoutUrl: "https://pay.ozow.test/checkout",
    });
  });

  it("rejects invalid UUID", async () => {
    mockAuth({ id: USER_ID });
    const req = createRequest("http://localhost:3000/api/listings/bad/boost");
    const res = await BoostPOST(req, { params: Promise.resolve({ id: "bad" }) });
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/boost`);
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when account profile not found", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: null }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/boost`);
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Account profile not found");
  });

  it("returns 404 when user does not own this listing", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/boost`);
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Listing not found");
  });

  it("returns 400 when listing is not live", async () => {
    mockAuth({ id: USER_ID });
    mockListingRow({
      id: UUID,
      title: "X",
      status: "draft",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      boost_until: null,
    });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/boost`);
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Only live listings can be boosted");
  });

  it("returns 400 when already boosted", async () => {
    mockAuth({ id: USER_ID });
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    mockListingRow({
      id: UUID,
      title: "X",
      status: "live",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      boost_until: futureDate,
    });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/boost`);
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This listing is already boosted");
  });

  it("returns 403 when entitlement denied", async () => {
    const { canBoost } = await import("@/lib/services/entitlements");
    vi.mocked(canBoost).mockReturnValueOnce({ allowed: false, reason: "Upgrade required" });
    setupHappyPath("boost_until");
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/boost`);
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Upgrade required");
  });

  it("returns 500 when payment insert fails", async () => {
    mockAuth({ id: USER_ID, email: "seller@test.com" });
    mockListingRow({
      id: UUID,
      title: "Test",
      status: "live",
      area: "MZANSI_MARKET",
      owner_id: USER_ID,
      boost_until: null,
    });
    mockAdmin({
      account_profiles: { maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }) },
    });
    mockCreateHostedCheckout.mockRejectedValueOnce(new Error("Checkout provider unavailable"));
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/boost`);
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to create boost checkout");
  });

  it("happy path returns checkout URL", async () => {
    setupHappyPath("boost_until");
    const req = createRequest(`http://localhost:3000/api/listings/${UUID}/boost`);
    const res = await BoostPOST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkoutUrl).toBe("https://pay.ozow.test/checkout");
    expect(body.paymentId).toBe("payment-1");
  });
});

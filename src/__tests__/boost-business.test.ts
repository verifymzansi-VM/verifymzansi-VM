import type * as Pricing from "@/lib/constants/pricing";
vi.mock("@/lib/billing/trial-addon-access", () => ({
  getTrialAddonBlock: vi.fn().mockResolvedValue(null),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { resetOwnerColumnCacheForTesting } from "@/lib/account/compat";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockLogAuditEvent,
  mockClientFrom,
  mockCheckLocalRateLimit,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockClientFrom: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
}));

const mockCreateHostedCheckout = vi.fn().mockResolvedValue({
  paymentId: "payment-1",
  checkoutUrl: "https://pay.ozow.test/checkout",
});

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
  env: vi.fn((key: string) => {
    const vars: Record<string, string> = {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      OZOW_ENV: "staging",
    };
    return vars[key] ?? "";
  }),
}));
vi.mock("@/lib/payments/checkout", () => ({
  createHostedCheckout: (...args: unknown[]) => mockCreateHostedCheckout(...args),
}));
vi.mock("@/lib/services/entitlements", () => ({
  canBoost: vi.fn(() => ({ allowed: true })),
}));
vi.mock("@/lib/services/plan-tier", () => ({
  getActivePlanTierForArea: vi.fn().mockResolvedValue("growth"),
}));
vi.mock("@/lib/constants/pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof Pricing>();
  return {
    ...actual,
    ADDON_PRICES: { boost: 1500, featured: 2500, urgent: 1000 },
    BOOST_DURATION_DAYS: 7,
  };
});
vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

import { POST } from "@/app/api/businesses/[id]/boost/route";

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "user-0001";

function createRequest(url: string): NextRequest {
  return {
    method: "POST",
    json: async () => ({}),
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL(url, "http://localhost:3000"),
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

function mockBusinessRow(row: Record<string, unknown> | null) {
  mockClientFrom.mockImplementation((table: string) => {
    if (table === "businesses") {
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

function setupHappyPath() {
  mockAuth({ id: USER_ID, email: "seller@test.com" });
  mockBusinessRow({
    id: VALID_UUID,
    business_name: "Test Business",
    status: "live",
    area: "MZANSI_BUSINESS",
    owner_id: USER_ID,
    boost_until: null,
  });
  mockAdmin({
    account_profiles: {
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
    },
  });
}

describe("POST /api/businesses/[id]/boost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockCreateHostedCheckout.mockResolvedValue({
      paymentId: "payment-1",
      checkoutUrl: "https://pay.ozow.test/checkout",
    });
    mockBusinessRow(null);
  });

  it("rejects invalid UUID", async () => {
    mockAuth({ id: USER_ID });
    const req = createRequest("http://localhost:3000/api/businesses/bad-id/boost");
    const res = await POST(req, { params: Promise.resolve({ id: "bad-id" }) });
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest(`http://localhost:3000/api/businesses/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when account profile not found", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/businesses/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Account profile not found");
  });

  it("returns 404 when business not found", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/businesses/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Business not found");
  });

  it("returns 404 when user does not own the business", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      account_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/businesses/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Business not found");
  });

  it("refuses boost for a live business: sold for events only", async () => {
    setupHappyPath();
    const req = createRequest(`http://localhost:3000/api/businesses/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "addon_unavailable" });
    expect(mockCreateHostedCheckout).not.toHaveBeenCalled();
  });
});

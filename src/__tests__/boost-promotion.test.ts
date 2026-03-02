import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
}));

const mockBuildPayFastCheckoutUrl = vi.fn().mockReturnValue("https://payfast.co.za/checkout");

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => {
    const vars: Record<string, string> = {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      PAYFAST_MERCHANT_ID: "m1",
      PAYFAST_MERCHANT_KEY: "k1",
      PAYFAST_NOTIFY_URL: "http://localhost:3000/api/webhooks/payfast",
    };
    return vars[key] ?? "";
  }),
}));
vi.mock("@/lib/services/payfast", () => ({
  buildPayFastCheckoutUrl: (...args: unknown[]) => mockBuildPayFastCheckoutUrl(...args),
}));
vi.mock("@/lib/constants/pricing", () => ({
  ADDON_PRICES: { boost: 1500, featured: 2500, urgent: 1000 },
  BOOST_DURATION_DAYS: 7,
}));

import { POST } from "@/app/api/promotions/[id]/boost/route";

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

function setupHappyPath() {
  mockAuth({ id: USER_ID, email: "test@example.com" });
  mockAdmin({
    seller_profiles: {
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
    },
    promotions: {
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: VALID_UUID,
          title: "Test Promotion",
          status: "live",
          seller_id: USER_ID,
          boost_until: null,
        },
      }),
    },
    payments: {
      single: vi.fn().mockResolvedValue({ data: { id: "payment-1" }, error: null }),
    },
  });
}

describe("POST /api/promotions/[id]/boost", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid UUID", async () => {
    mockAuth({ id: USER_ID });
    const req = createRequest("http://localhost:3000/api/promotions/not-a-uuid/boost");
    const res = await POST(req, { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid");
  });

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when seller profile not found", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      seller_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Seller profile not found");
  });

  it("returns 404 when promotion not found", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      seller_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
      promotions: {
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Promotion not found");
  });

  it("returns 403 when user does not own the promotion", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      seller_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
      promotions: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: VALID_UUID,
            title: "Not My Promo",
            status: "live",
            seller_id: "different-user",
            boost_until: null,
          },
        }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("don't own");
  });

  it("returns 400 when promotion is not live", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      seller_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
      promotions: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: VALID_UUID,
            title: "Draft Promo",
            status: "draft",
            seller_id: USER_ID,
            boost_until: null,
          },
        }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/only live/i);
  });

  it("returns 400 when promotion is already boosted", async () => {
    mockAuth({ id: USER_ID });
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    mockAdmin({
      seller_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
      promotions: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: VALID_UUID,
            title: "Boosted Promo",
            status: "live",
            seller_id: USER_ID,
            boost_until: futureDate,
          },
        }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already/i);
  });

  it("returns 500 when payment creation fails", async () => {
    mockAuth({ id: USER_ID });
    mockAdmin({
      seller_profiles: {
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "sp-1" } }),
      },
      promotions: {
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: VALID_UUID,
            title: "Test Promo",
            status: "live",
            seller_id: USER_ID,
            boost_until: null,
          },
        }),
      },
      payments: {
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "DB connection lost" },
        }),
      },
    });
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/payment/i);
  });

  it("happy path: returns checkout URL and payment ID", async () => {
    setupHappyPath();
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkoutUrl).toBe("https://payfast.co.za/checkout");
    expect(body.paymentId).toBe("payment-1");
  });

  it("passes amount in ZAR (cents ÷ 100) to PayFast", async () => {
    setupHappyPath();
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });

    expect(mockBuildPayFastCheckoutUrl).toHaveBeenCalledTimes(1);
    const passedParams = mockBuildPayFastCheckoutUrl.mock.calls[0][0];
    expect(passedParams.amount).toBe(15); // 1500 / 100
  });

  it("logs audit event on successful checkout", async () => {
    setupHappyPath();
    const req = createRequest(`http://localhost:3000/api/promotions/${VALID_UUID}/boost`);
    await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const auditEntry = mockLogAuditEvent.mock.calls[0][0];
    expect(auditEntry.actorId).toBe(USER_ID);
    expect(auditEntry.targetId).toBe(VALID_UUID);
    expect(auditEntry.targetType).toBe("promotion");
  });
});

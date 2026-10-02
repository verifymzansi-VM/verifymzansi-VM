import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/billing/payment-status/route";
import { createClient } from "@/lib/supabase/server";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import type { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
const mockReconcile = vi.hoisted(() => vi.fn());
const admin = {};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/payments/reconciliation", () => ({ reconcileOzowPayment: mockReconcile }));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: vi.fn().mockReturnValue({ limited: false }),
}));

function createRequest(url: string): NextRequest {
  const request = new Request(url);
  return Object.assign(request, {
    nextUrl: new URL(url),
  }) as NextRequest;
}

const PAYMENT_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("GET /api/billing/payment-status", () => {
  const mockSupabase = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReconcile.mockReset().mockResolvedValue({ checked: true });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(checkLocalRateLimit).mockReturnValue({ limited: false });
  });

  it("returns 400 when the payment id is not a UUID", async () => {
    const res = await GET(
      createRequest("https://verifymzansi.com/api/billing/payment-status?payment=abc")
    );

    expect(res.status).toBe(400);
    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
  });

  it("reconciles an owned payment and returns the newly persisted completion", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const payment = {
      id: PAYMENT_ID,
      status: "pending",
      provider: "ozow",
      provider_payment_id: "request-1",
      created_at: "2026-10-02T10:00:00Z",
    };
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValueOnce({ data: payment, error: null })
        .mockResolvedValueOnce({ data: { status: "complete" }, error: null }),
    };
    mockSupabase.from.mockReturnValue(query);
    const response = await GET(
      createRequest(`https://verifymzansi.com/api/billing/payment-status?payment=${PAYMENT_ID}`)
    );
    expect(await response.json()).toEqual({ status: "complete", terminal: true, expired: false });
    expect(mockReconcile).toHaveBeenCalledWith(payment, admin);
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("preserves an old pending status during provider outages", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: PAYMENT_ID,
          status: "pending",
          provider: "ozow",
          provider_payment_id: "request-1",
          created_at: "2020-01-01T10:00:00Z",
        },
        error: null,
      }),
    };
    mockSupabase.from.mockReturnValue(query);
    mockReconcile.mockRejectedValue(new Error("Ozow unavailable"));
    const response = await GET(
      createRequest(`https://verifymzansi.com/api/billing/payment-status?payment=${PAYMENT_ID}`)
    );
    expect(await response.json()).toEqual({ status: "pending", terminal: false, expired: false });
  });

  it("returns 401 when the user is not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    const res = await GET(
      createRequest(`https://verifymzansi.com/api/billing/payment-status?payment=${PAYMENT_ID}`)
    );

    expect(res.status).toBe(401);
  });

  it("returns 429 when the polling rate limit is exceeded", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    vi.mocked(checkLocalRateLimit).mockReturnValue({ limited: true, retryAfter: 45 });

    const res = await GET(
      createRequest(`https://verifymzansi.com/api/billing/payment-status?payment=${PAYMENT_ID}`)
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("45");
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it("treats blank payment ids as missing instead of querying the database", async () => {
    const res = await GET(
      createRequest("https://verifymzansi.com/api/billing/payment-status?payment=%20%20%20")
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "missing", terminal: true });
    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
  });

  it("maps processing payments to pending", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { status: "processing" } }),
    });

    const res = await GET(
      createRequest(`https://verifymzansi.com/api/billing/payment-status?payment=${PAYMENT_ID}`)
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "pending", terminal: false });
  });

  it("returns complete for completed payments", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { status: "complete" } }),
    });

    const res = await GET(
      createRequest(`https://verifymzansi.com/api/billing/payment-status?payment=${PAYMENT_ID}`)
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "complete", terminal: true });
  });

  it("returns 500 when the payment query encounters a DB error", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "connection refused" },
      }),
    });

    const res = await GET(
      createRequest(`https://verifymzansi.com/api/billing/payment-status?payment=${PAYMENT_ID}`)
    );

    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});

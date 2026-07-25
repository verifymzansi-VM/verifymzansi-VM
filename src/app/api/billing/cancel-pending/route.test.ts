import { describe, it, expect, vi, beforeEach } from "vitest";
import { type NextRequest } from "next/server";
import { POST as cancelPendingPayment } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const CSRF_TOKEN = "a".repeat(64);
const PAYMENT_ID = "550e8400-e29b-41d4-a716-446655440001";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
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
  const url = "https://verifymzansi.com/api/billing/cancel-pending";
  const request = new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "https://verifymzansi.com",
      "sec-fetch-site": "same-origin",
      cookie: `vm_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    },
  });

  return Object.assign(request, {
    nextUrl: new URL(url),
  }) as NextRequest;
}

describe("POST /api/billing/cancel-pending", () => {
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
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email_confirmed_at: "2026-01-01T00:00:00.000Z" } },
    });
  });

  it("marks the user's pending payment as failed", async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: PAYMENT_ID, status: "failed" },
                error: null,
              }),
            }),
          }),
        }),
      }),
    });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table !== "payments") throw new Error(`Unexpected table: ${table}`);
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: PAYMENT_ID,
            status: "pending",
            provider_data: { checkout_url: "https://pay.ozow.com/resume/pay-pending" },
          },
          error: null,
        }),
        update,
      };
    });

    const res = await cancelPendingPayment(createMockRequest({ paymentId: PAYMENT_ID }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true, paymentId: PAYMENT_ID, status: "failed" });
    expect(update).toHaveBeenCalledWith({
      status: "failed",
      provider_data: expect.objectContaining({
        checkout_url: "https://pay.ozow.com/resume/pay-pending",
        failure_reason: "user_cancelled",
        cancelled_at: expect.any(String),
      }),
    });
  });

  it("returns 409 when the payment changed before the cancellation landed", async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table !== "payments") throw new Error(`Unexpected table: ${table}`);
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: PAYMENT_ID, status: "pending", provider_data: {} },
          error: null,
        }),
        update,
      };
    });

    const res = await cancelPendingPayment(createMockRequest({ paymentId: PAYMENT_ID }));
    expect(res.status).toBe(409);
  });

  it("does not cancel a payment that is already processing", async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table !== "payments") throw new Error(`Unexpected table: ${table}`);
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: PAYMENT_ID, status: "processing", provider_data: {} },
          error: null,
        }),
      };
    });

    const res = await cancelPendingPayment(createMockRequest({ paymentId: PAYMENT_ID }));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toContain("already being processed");
  });
});

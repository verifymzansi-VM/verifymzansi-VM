import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockParseAndValidateSearchParams } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockParseAndValidateSearchParams: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/api", () => ({
  parseAndValidateSearchParams: mockParseAndValidateSearchParams,
}));
vi.mock("@/lib/validations/shared", () => ({
  optionalTrimmedStringSchema: { optional: () => ({}) },
}));

import { GET } from "@/app/api/billing/payment-status/route";

function makeRequest(paymentId?: string) {
  const url = paymentId
    ? `http://localhost:3000/api/billing/payment-status?payment=${paymentId}`
    : "http://localhost:3000/api/billing/payment-status";

  return {
    method: "GET",
    url,
    headers: new Headers(),
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

describe("GET /api/billing/payment-status", () => {
  const fromFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "u1" } },
          error: null,
        }),
      },
      from: fromFn,
    });
  });

  it("returns expired:true for pending payments older than 30 minutes", async () => {
    const thirtyFiveMinAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString();

    mockParseAndValidateSearchParams.mockReturnValue({
      success: true,
      data: { payment: "pay-1" },
    });

    fromFn.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { status: "pending", created_at: thirtyFiveMinAgo },
              error: null,
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest("pay-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expired).toBe(true);
    expect(body.terminal).toBe(true);
    expect(body.status).toBe("expired");
  });

  it("returns expired:false for recent pending payments", async () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    mockParseAndValidateSearchParams.mockReturnValue({
      success: true,
      data: { payment: "pay-2" },
    });

    fromFn.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { status: "pending", created_at: twoMinAgo },
              error: null,
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest("pay-2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expired).toBe(false);
  });

  it("does not mark completed payments as expired regardless of age", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    mockParseAndValidateSearchParams.mockReturnValue({
      success: true,
      data: { payment: "pay-3" },
    });

    fromFn.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { status: "complete", created_at: twoHoursAgo },
              error: null,
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest("pay-3"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expired).toBe(false);
    expect(body.terminal).toBe(true);
  });

  // ── C3 regression: null payment returns missing status instead of infinite poll ──

  it("returns status:missing and terminal:true when payment is not found", async () => {
    mockParseAndValidateSearchParams.mockReturnValue({
      success: true,
      data: { payment: "pay-nonexistent" },
    });

    fromFn.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest("pay-nonexistent"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("missing");
    expect(body.terminal).toBe(true);
  });
});

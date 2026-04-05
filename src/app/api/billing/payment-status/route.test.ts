import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/billing/payment-status/route";
import { createClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

function createRequest(url: string): NextRequest {
  const request = new Request(url);
  return Object.assign(request, {
    nextUrl: new URL(url),
  }) as NextRequest;
}

describe("GET /api/billing/payment-status", () => {
  const mockSupabase = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
  });

  it("returns 401 when the user is not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    const res = await GET(
      createRequest("https://verifymzansi.com/api/billing/payment-status?payment=pay-1")
    );

    expect(res.status).toBe(401);
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
      createRequest("https://verifymzansi.com/api/billing/payment-status?payment=pay-1")
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
      createRequest("https://verifymzansi.com/api/billing/payment-status?payment=pay-1")
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
      createRequest("https://verifymzansi.com/api/billing/payment-status?payment=pay-1")
    );

    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});

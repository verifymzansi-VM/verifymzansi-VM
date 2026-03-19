import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/billing/payment-status/route";
import { createClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

function createRequest(url: string): NextRequest {
  return {
    nextUrl: new URL(url),
    url,
  } as unknown as NextRequest;
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
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

import { POST } from "@/app/api/auth/sign-out/route";

function createRequest(url = "http://localhost:3000/api/auth/sign-out") {
  return {
    method: "POST",
    url,
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as Request;
}

describe("POST /api/auth/sign-out", () => {
  beforeEach(() => vi.clearAllMocks());

  it("signs out and redirects to root", async () => {
    const mockSignOut = vi.fn().mockResolvedValue({ error: null });
    mockCreateClient.mockResolvedValue({ auth: { signOut: mockSignOut } });

    const res = await POST(createRequest());
    expect(mockSignOut).toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/");
  });

  it("redirects even if signOut throws", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { signOut: vi.fn().mockRejectedValue(new Error("fail")) },
    });

    const res = await POST(createRequest());
    // Should still redirect, not throw
    expect(res.status).toBe(302);
  });
});

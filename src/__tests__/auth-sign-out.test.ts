import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));

import { POST } from "@/app/api/auth/sign-out/route";

function createRequest(url = "http://localhost:3000/api/auth/sign-out") {
  return {
    method: "POST",
    url,
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

function createCrossSiteRequest(url = "https://verifymzansi.com/api/auth/sign-out") {
  return {
    method: "POST",
    url,
    headers: new Headers({ origin: "https://evil.example" }),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

describe("POST /api/auth/sign-out", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("signs out and redirects to root", async () => {
    const mockSignOut = vi.fn().mockResolvedValue({ error: null });
    mockCreateClient.mockResolvedValue({ auth: { signOut: mockSignOut } });

    const res = await POST(createRequest());
    expect(mockSignOut).toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/");
    expect(res.cookies.get("x-phone-ok")).toMatchObject({
      name: "x-phone-ok",
      value: "",
    });
  });

  it("returns 503 when signOut throws", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { signOut: vi.fn().mockRejectedValue(new Error("fail")) },
    });

    const res = await POST(createRequest());
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: "Failed to sign out. Please try again.",
    });
  });

  it("uses the public request origin when a stale localhost app url is configured in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    mockCreateClient.mockResolvedValue({
      auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
    });

    const res = await POST(createRequest("https://verifymzansi.com/api/auth/sign-out"));

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://verifymzansi.com/");
  });

  it("rejects cross-site sign-out requests", async () => {
    const res = await POST(createCrossSiteRequest());

    expect(res.status).toBe(403);
  });
});

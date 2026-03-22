import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCheckLocalRateLimit } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCheckLocalRateLimit: vi.fn().mockReturnValue({ limited: false }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

import { POST } from "@/app/api/auth/oauth/google/route";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/utils/csrf";

function createRequest(body: unknown, url = "http://localhost:3000/api/auth/oauth/google") {
  const csrfToken = "a".repeat(64);
  return {
    method: "POST",
    json: async () => body,
    url,
    headers: new Headers({
      origin: "http://localhost:3000",
      cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
      [CSRF_HEADER_NAME]: csrfToken,
    }),
    cookies: {
      get(name: string) {
        if (name === CSRF_COOKIE_NAME) {
          return { value: csrfToken };
        }
        return undefined;
      },
    },
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

describe("POST /api/auth/oauth/google", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a Google OAuth URL from the backend route", async () => {
    const mockSignInWithOAuth = vi.fn().mockResolvedValue({
      data: { url: "https://accounts.google.com/o/oauth2/v2/auth?state=test" },
      error: null,
    });
    mockCreateClient.mockResolvedValue({
      auth: { signInWithOAuth: mockSignInWithOAuth },
    });

    const res = await POST(createRequest({ returnUrl: "/post/create" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      url: "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    });
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fpost%2Fcreate",
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
        skipBrowserRedirect: true,
      },
    });
  });

  it("sanitizes unsafe return URLs before building the callback", async () => {
    const mockSignInWithOAuth = vi.fn().mockResolvedValue({
      data: { url: "https://accounts.google.com/o/oauth2/v2/auth?state=test" },
      error: null,
    });
    mockCreateClient.mockResolvedValue({
      auth: { signInWithOAuth: mockSignInWithOAuth },
    });

    const res = await POST(createRequest({ returnUrl: "https://evil.example/phish" }));

    expect(res.status).toBe(200);
    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo: "http://localhost:3000/auth/callback?next=%2Fdashboard",
        }),
      })
    );
  });

  it("returns 503 when Supabase cannot create the OAuth URL", async () => {
    const mockSignInWithOAuth = vi.fn().mockResolvedValue({
      data: { url: null },
      error: { message: "provider unavailable" },
    });
    mockCreateClient.mockResolvedValue({
      auth: { signInWithOAuth: mockSignInWithOAuth },
    });

    const res = await POST(createRequest({ returnUrl: "/dashboard" }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "Google sign-in is temporarily unavailable. Please try again.",
    });
  });

  it("rejects requests without a valid CSRF token", async () => {
    const request = createRequest({ returnUrl: "/dashboard" });
    request.headers.delete(CSRF_HEADER_NAME);

    const res = await POST(request);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Invalid CSRF token" });
  });
});

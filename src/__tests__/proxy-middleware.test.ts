import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

import { routeRequest as proxy } from "@/middleware";

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMockRequest(path: string, options?: { hostname?: string }): NextRequest {
  const hostname = options?.hostname ?? "localhost";
  const url = `http://${hostname}:3000${path}`;
  return new NextRequest(url);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("proxy middleware — missing Supabase env", () => {
  const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    // Restore originals (may be undefined, which is fine)
    if (origUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
    else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (origKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
    else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("returns 503 for protected API routes when Supabase not configured", async () => {
    const res = await proxy(createMockRequest("/api/admin/users"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/misconfigured/i);
  });

  it("redirects protected page routes to / when Supabase not configured", async () => {
    const res = await proxy(createMockRequest("/dashboard"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });

  it("allows public pages through when Supabase not configured", async () => {
    const res = await proxy(createMockRequest("/"));
    // NextResponse.next() returns 200
    expect(res.status).toBe(200);
  });

  it("redirects legacy root auth code links to the callback route", async () => {
    const res = await proxy(createMockRequest("/?code=legacy-code&type=signup"));
    expect(res.status).toBe(307);

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).not.toBe("/");
    expect(location.pathname).toBe("/auth/callback");
    expect(location.searchParams.get("code")).toBe("legacy-code");
    expect(location.searchParams.get("type")).toBe("signup");
    expect(location.searchParams.get("next")).toBe("/login?confirmed=true");
  });

  it("blocks /billing when Supabase not configured", async () => {
    const res = await proxy(createMockRequest("/billing/checkout"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });

  it("blocks /verification when Supabase not configured", async () => {
    const res = await proxy(createMockRequest("/verification"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });
});

describe("proxy middleware — authenticated routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  it("redirects unauthenticated users from /dashboard to /login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await proxy(createMockRequest("/dashboard"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnUrl")).toBe("/dashboard");
  });

  it("returns 401 for unauthenticated API requests to protected routes", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    // /api routes under protected prefixes like /dashboard don't exist,
    // but /api/admin is a protected admin prefix
    const res = await proxy(createMockRequest("/api/admin/stats"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin users on admin routes", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          is_anonymous: false,
          app_metadata: { role: "seller" },
        },
      },
    });

    const res = await proxy(createMockRequest("/api/admin/stats"));
    expect(res.status).toBe(403);
  });

  it("allows admin users through admin routes", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          is_anonymous: false,
          app_metadata: { role: "admin" },
        },
      },
    });

    const res = await proxy(createMockRequest("/admin/dashboard"));
    expect(res.status).toBe(200);
  });

  it("allows moderator users through admin routes", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          is_anonymous: false,
          app_metadata: { role: "moderator" },
        },
      },
    });

    const res = await proxy(createMockRequest("/admin/reports"));
    expect(res.status).toBe(200);
  });

  it("redirects logged-in real users away from /login", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          is_anonymous: false,
          app_metadata: { role: "seller" },
        },
      },
    });

    const res = await proxy(createMockRequest("/login"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("allows the public home page without redirecting", async () => {
    const res = await proxy(createMockRequest("/"));
    expect(res.status).toBe(200);
  });

  it("does not redirect the auth callback route again", async () => {
    const res = await proxy(createMockRequest("/auth/callback?code=legacy-code&type=signup"));
    expect(res.status).toBe(200);
  });

  it("does NOT redirect anonymous users from /login", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "anon-1",
          is_anonymous: true,
          app_metadata: {},
        },
      },
    });

    const res = await proxy(createMockRequest("/login"));
    expect(res.status).toBe(200);
  });

  it("redirects posting pages to /dashboard when seller profile lookup fails", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          is_anonymous: false,
          app_metadata: { role: "seller" },
        },
      },
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "upstream timeout", code: "ETIMEDOUT" },
          }),
        }),
      }),
    });

    const res = await proxy(createMockRequest("/post/create"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("returns 503 for posting API routes when seller profile lookup fails", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          is_anonymous: false,
          app_metadata: { role: "seller" },
        },
      },
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "upstream timeout", code: "ETIMEDOUT" },
          }),
        }),
      }),
    });

    const res = await proxy(createMockRequest("/api/post/create"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/posting eligibility service unavailable/i);
  });
});

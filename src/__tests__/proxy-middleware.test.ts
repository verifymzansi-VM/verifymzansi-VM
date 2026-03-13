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

import { proxy, routeRequest } from "@/proxy";

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMockRequest(path: string, options?: { hostname?: string }): NextRequest {
  const hostname = options?.hostname ?? "localhost";
  const url = `http://${hostname}:3000${path}`;
  return new NextRequest(url);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("middleware — missing Supabase env", () => {
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
    const res = await routeRequest(createMockRequest("/api/admin/users"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/misconfigured/i);
  });

  it("redirects protected page routes to / when Supabase not configured", async () => {
    const res = await routeRequest(createMockRequest("/dashboard"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });

  it("allows public pages through when Supabase not configured", async () => {
    const res = await routeRequest(createMockRequest("/"));
    // NextResponse.next() returns 200
    expect(res.status).toBe(200);
  });

  it("redirects legacy root auth code links to the callback route", async () => {
    const res = await routeRequest(createMockRequest("/?code=legacy-code&type=signup"));
    expect(res.status).toBe(307);

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).not.toBe("/");
    expect(location.pathname).toBe("/auth/callback");
    expect(location.searchParams.get("code")).toBe("legacy-code");
    expect(location.searchParams.get("type")).toBe("signup");
    expect(location.searchParams.get("next")).toBe("/?confirmed=true");
  });

  it("blocks /billing when Supabase not configured", async () => {
    const res = await routeRequest(createMockRequest("/billing/checkout"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });

  it("blocks /verification when Supabase not configured", async () => {
    const res = await routeRequest(createMockRequest("/verification"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });
});

describe("proxy security headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PLAYWRIGHT_SUPABASE_MODE;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("adds the full security header set to successful responses", async () => {
    const res = await proxy(createMockRequest("/"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("keeps basic security headers on redirects", async () => {
    const res = await proxy(createMockRequest("/dashboard"));

    expect(res.status).toBe(307);
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("middleware — authenticated routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  it("redirects unauthenticated users from /dashboard to /login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await routeRequest(createMockRequest("/dashboard"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnUrl")).toBe("/dashboard");
  });

  it("returns 401 for unauthenticated API requests to protected routes", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    // /api routes under protected prefixes like /dashboard don't exist,
    // but /api/admin is a protected admin prefix
    const res = await routeRequest(createMockRequest("/api/admin/stats"));
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

    const res = await routeRequest(createMockRequest("/api/admin/stats"));
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

    const res = await routeRequest(createMockRequest("/admin/dashboard"));
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

    const res = await routeRequest(createMockRequest("/admin/reports"));
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

    const res = await routeRequest(createMockRequest("/login"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("allows the public home page without redirecting", async () => {
    const res = await routeRequest(createMockRequest("/"));
    expect(res.status).toBe(200);
  });

  it("does not redirect the auth callback route again", async () => {
    const res = await routeRequest(
      createMockRequest("/auth/callback?code=legacy-code&type=signup")
    );
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

    const res = await routeRequest(createMockRequest("/login"));
    expect(res.status).toBe(200);
  });

  it("allows /post/create through without legacy seller verification lookup", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          is_anonymous: false,
          app_metadata: { role: "seller" },
        },
      },
    });

    // The phone-missing gate calls from("account_profiles") to check for a phone.
    // Return a profile that already has a phone set so the gate lets the request through.
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { phone: "+27600000000" }, error: null }),
        }),
      }),
    });

    const res = await routeRequest(createMockRequest("/post/create"));
    expect(res.status).toBe(200);
  });

  it("allows legacy /api/post/create paths through middleware without legacy seller gating", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          is_anonymous: false,
          app_metadata: { role: "seller" },
        },
      },
    });

    const res = await routeRequest(createMockRequest("/api/post/create"));
    expect(res.status).toBe(200);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("middleware — Playwright stub mode", () => {
  const originalStubMode = process.env.PLAYWRIGHT_SUPABASE_MODE;
  const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLAYWRIGHT_SUPABASE_MODE = "stub";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://playwright.supabase.stub";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "playwright-anon-key";
  });

  afterEach(() => {
    if (originalStubMode) process.env.PLAYWRIGHT_SUPABASE_MODE = originalStubMode;
    else delete process.env.PLAYWRIGHT_SUPABASE_MODE;

    if (origUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
    else delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (origKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
    else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("allows public pages without calling Supabase", async () => {
    const res = await routeRequest(createMockRequest("/mzansi-market"));

    expect(res.status).toBe(200);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("redirects protected pages to login with returnUrl", async () => {
    const res = await routeRequest(createMockRequest("/dashboard"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnUrl")).toBe("/dashboard");
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("returns 401 for protected API routes", async () => {
    const res = await routeRequest(createMockRequest("/api/verification/session/start"));

    expect(res.status).toBe(401);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("keeps auth pages reachable", async () => {
    const res = await routeRequest(createMockRequest("/login"));

    expect(res.status).toBe(200);
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});

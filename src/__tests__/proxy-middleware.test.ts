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

import { middleware } from "@/middleware";
import { routeRequest } from "@/proxy-handler";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMockRequest(
  path: string,
  options?: { hostname?: string; cookieHeader?: string }
): NextRequest {
  const hostname = options?.hostname ?? "localhost";
  const url = `http://${hostname}:3000${path}`;
  return new NextRequest(url, {
    headers: options?.cookieHeader ? { cookie: options.cookieHeader } : undefined,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("proxy — missing Supabase env", () => {
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
    expect(location.searchParams.get("next")).toBe("/login?confirmed=true");
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
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("adds the full security header set to successful responses", async () => {
    const res = await middleware(createMockRequest("/"));
    const csp = res.headers.get("Content-Security-Policy");
    const setCookie = res.headers.get("set-cookie");

    expect(res.status).toBe(200);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("https://*.r2.cloudflarestorage.com");
    expect(csp).toContain("https://images.unsplash.com");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(setCookie).toContain("vm_csrf=");
  });

  it("uses a development-friendly CSP without x-nonce in development", async () => {
    const res = await middleware(createMockRequest("/"));
    const csp = res.headers.get("Content-Security-Policy");

    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(res.headers.get("x-nonce")).toBeNull();
  });

  it("uses strict nonce CSP in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const res = await middleware(createMockRequest("/", { hostname: "verifymzansi.com" }));
    const csp = res.headers.get("Content-Security-Policy");
    const nonce = res.headers.get("x-nonce");

    expect(nonce).toBeTruthy();
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("style-src 'self' 'nonce-");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
  });

  it("keeps basic security headers on redirects", async () => {
    const res = await middleware(createMockRequest("/dashboard"));

    expect(res.status).toBe(307);
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("guarantees CSRF cookie is set even with cookie extraction edge cases", async () => {
    // This test validates the fallback behavior in withSecurityHeaders:
    // The temporary ensureCsrfCookie response may not synchronously finalize
    // its cookies yet, so proxy-handler must ensure the final response always
    // includes vm_csrf, either by extracting from temporary response or by
    // explicitly setting it with the computed token.
    const res = await middleware(createMockRequest("/"));
    const setCookie = res.headers.get("set-cookie");

    expect(res.status).toBe(200);
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("vm_csrf=");

    // Verify cookie attributes are correct (httpOnly=false so client can read it)
    const cookieParts =
      setCookie?.split(";").map((part: string) => part.trim().toLowerCase()) ?? [];
    expect(cookieParts.some((part: string) => part.startsWith("path=/"))).toBe(true);
    expect(cookieParts.some((part: string) => part.startsWith("samesite="))).toBe(true);
    // secure attribute depends on protocol detection; at least verify no errors
    expect(setCookie).toBeTruthy();
  });

  it("does not set a CSRF cookie on cacheable media proxy requests", async () => {
    const res = await middleware(
      createMockRequest("/api/media/serve/media/listing/example/photo.jpg", {
        hostname: "verifymzansi.com",
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not set a CSRF cookie on cacheable public image requests", async () => {
    const res = await middleware(createMockRequest("/images/logo-transparent.png"));

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("clears stale Playwright session cookies outside stub mode", async () => {
    const res = await middleware(
      createMockRequest("/", { cookieHeader: "vmz_pw_session=persona%3Aold" })
    );
    const setCookie = res.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("vmz_pw_session=");
    expect(setCookie).toContain("Max-Age=0");
  });
});

describe("proxy — authenticated routing", () => {
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

  it("preserves nested verification returnUrl when redirecting unauthenticated users to login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await routeRequest(
      createMockRequest("/verification?returnUrl=%2Fpost%2Fcreate-listing")
    );

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnUrl")).toBe(
      "/verification?returnUrl=%2Fpost%2Fcreate-listing"
    );
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
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
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

  it("preserves nested verification returnUrl for anonymous sessions", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "anon-1",
          is_anonymous: true,
          app_metadata: {},
        },
      },
    });

    const res = await routeRequest(
      createMockRequest("/verification?returnUrl=%2Fpost%2Fcreate-business")
    );

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnUrl")).toBe(
      "/verification?returnUrl=%2Fpost%2Fcreate-business"
    );
  });

  it("allows /post/create through for verified users", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          is_anonymous: false,
          app_metadata: { role: "seller" },
        },
      },
    });

    // The phone-missing gate and posting gate both call from("account_profiles").
    // Return a verified profile with phone so both gates pass.
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                phone: "+27600000000",
                account_verification_status: "verified",
                account_status: "active",
                suspended_until: null,
              },
              error: null,
            }),
        }),
      }),
    });

    const res = await routeRequest(createMockRequest("/post/create"));
    expect(res.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith(ACCOUNT_PROFILE_WRITE_TABLE);
    expect(ACCOUNT_PROFILE_WRITE_TABLE).toBe("account_profiles");
  });

  it("does not trust a stale x-phone-ok cookie when the profile no longer has a phone", async () => {
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
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                phone: null,
                account_verification_status: "verified",
                account_status: "active",
                suspended_until: null,
              },
              error: null,
            }),
        }),
      }),
    });

    const res = await routeRequest(
      createMockRequest("/dashboard", { cookieHeader: "x-phone-ok=1" })
    );

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/dashboard/complete-profile");
    expect(location.searchParams.get("returnUrl")).toBe("/dashboard");
  });

  it("redirects to the recovery page when the phone gate profile lookup fails", async () => {
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
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.reject(new Error("database offline")),
        }),
      }),
    });

    const res = await routeRequest(createMockRequest("/dashboard"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/error");
    expect(location.searchParams.get("reason")).toBe("unavailable");
  });

  it("allows /api/post/create for verified users through posting gate", async () => {
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
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                phone: "+27600000000",
                account_verification_status: "verified",
                account_status: "active",
                suspended_until: null,
              },
              error: null,
            }),
        }),
      }),
    });

    const res = await routeRequest(createMockRequest("/api/post/create"));
    expect(res.status).toBe(200);
  });

  it("allows verified posting routes when the legacy profile status is stale but all steps are approved", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          is_anonymous: false,
          app_metadata: { role: "seller" },
        },
      },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              phone: "+27600000000",
              account_verification_status: "incomplete",
              account_status: "active",
              suspended_until: null,
            },
            error: null,
          }),
        };
      }

      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [
              { step_type: "phone", status: "approved" },
              { step_type: "id_doc", status: "approved" },
              { step_type: "selfie", status: "approved" },
              { step_type: "location", status: "approved" },
            ],
            error: null,
          }),
        };
      }

      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    const res = await routeRequest(createMockRequest("/post/create-business"));
    expect(res.status).toBe(200);
  });

  it("preserves the returnUrl when an unverified user is redirected from an edit posting route", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          is_anonymous: false,
          app_metadata: { role: "seller" },
        },
      },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              phone: "+27600000000",
              account_verification_status: "incomplete",
              account_status: "active",
              suspended_until: null,
            },
            error: null,
          }),
        };
      }

      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ step_type: "phone", status: "approved" }],
            error: null,
          }),
        };
      }

      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    const res = await routeRequest(createMockRequest("/post/edit-business/123"));
    expect(res.status).toBe(307);

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/verification");
    expect(location.searchParams.get("returnUrl")).toBe("/post/edit-business/123");
  });
});

describe("proxy — Playwright stub mode", () => {
  const originalStubMode = process.env.PLAYWRIGHT_SUPABASE_MODE;
  const originalPublicStubMode = process.env.NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE;
  const originalPlaywrightTestMode = process.env.PLAYWRIGHT_TEST_MODE;
  const originalPublicPlaywrightTestMode = process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE;
  const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockImplementation(() => {
      throw new Error("Supabase auth should not be called in stub mode");
    });
    document.documentElement.dataset.playwright = "1";
    process.env.PLAYWRIGHT_SUPABASE_MODE = "stub";
    // jsdom defines `window`, so isPlaywrightSupabaseStubMode() checks
    // the NEXT_PUBLIC_ variant — set it too so the stub branch activates.
    process.env.NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE = "stub";
    process.env.PLAYWRIGHT_TEST_MODE = "1";
    process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://playwright.supabase.stub";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "playwright-anon-key";
  });

  afterEach(() => {
    delete document.documentElement.dataset.playwright;

    if (originalStubMode) process.env.PLAYWRIGHT_SUPABASE_MODE = originalStubMode;
    else delete process.env.PLAYWRIGHT_SUPABASE_MODE;

    if (originalPublicStubMode)
      process.env.NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE = originalPublicStubMode;
    else delete process.env.NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE;

    if (originalPlaywrightTestMode) process.env.PLAYWRIGHT_TEST_MODE = originalPlaywrightTestMode;
    else delete process.env.PLAYWRIGHT_TEST_MODE;

    if (originalPublicPlaywrightTestMode) {
      process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE = originalPublicPlaywrightTestMode;
    } else {
      delete process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE;
    }

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

  it("allows protected pages when a valid playwright stub session cookie is present", async () => {
    process.env.PLAYWRIGHT_TEST_MODE = "1";
    process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE = "1";
    process.env.PLAYWRIGHT_E2E_AUTH = "1";

    const res = await routeRequest(
      createMockRequest("/dashboard", {
        cookieHeader: "vmz_pw_session=persona%3Aproxy-authenticated",
      })
    );

    expect(res.status).toBe(200);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("does not allow stub mode on non-test hosts", async () => {
    process.env.PLAYWRIGHT_TEST_MODE = "1";
    process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE = "1";
    process.env.PLAYWRIGHT_E2E_AUTH = "1";
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await routeRequest(
      createMockRequest("/dashboard", {
        hostname: "verifymzansi.com",
        cookieHeader: "vmz_pw_session=persona%3Aproxy-authenticated",
      })
    );

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnUrl")).toBe("/dashboard");
    expect(mockGetUser).toHaveBeenCalled();
  });
});

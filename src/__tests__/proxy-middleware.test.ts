import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const { checkFoundationPageAccess } = vi.hoisted(() => ({ checkFoundationPageAccess: vi.fn() }));
vi.mock("@/lib/foundation/page-access", () => ({ checkFoundationPageAccess }));

import { middleware } from "@/middleware";
import { routeRequest } from "@/proxy-handler";

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMockRequest(
  path: string,
  options?: { hostname?: string; cookieHeader?: string; ip?: string }
): NextRequest {
  const hostname = options?.hostname ?? "localhost";
  const url = `http://${hostname}:3000${path}`;
  const headers: Record<string, string> = {};
  if (options?.cookieHeader) headers.cookie = options.cookieHeader;
  if (options?.ip) headers["x-forwarded-for"] = options.ip;
  return new NextRequest(url, {
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("proxy — immutable posting terms versions", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    "/terms/versions/not-a-published-version",
    "/terms/versions/constructor",
    "/terms/versions/posting-v1/extra",
    "/terms/versions/posting-v3/extra",
    "/terms/versions/posting-v4",
    "/terms/versions",
  ])("rejects unpublished paths before streaming or Auth: %s", async (path) => {
    const response = await routeRequest(createMockRequest(path));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(checkFoundationPageAccess).not.toHaveBeenCalled();
  });

  it("allows the exact archived document and ignores unrelated path prefixes", async () => {
    for (const path of [
      "/terms/versions/posting-v1?from=terms",
      "/terms/versions/posting-v3",
      "/terms/versions-extra/example",
    ])
      expect((await routeRequest(createMockRequest(path))).headers.get("x-middleware-next")).toBe(
        "1"
      );
    expect(checkFoundationPageAccess).not.toHaveBeenCalled();
  });
});

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

  it("returns 503 for private account API routes when Supabase not configured", async () => {
    const res = await routeRequest(createMockRequest("/api/account/delete"));
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
    // React's dev overlay needs eval(); the production test below forbids it.
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(res.headers.get("x-nonce")).toBeNull();
  });

  it("uses strict nonce CSP in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const res = await middleware(createMockRequest("/", { hostname: "verifymzansi.com" }));
    const csp = res.headers.get("Content-Security-Policy");
    const nonce = res.headers.get("x-nonce");

    expect(nonce).toBeTruthy();
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("style-src 'self' 'nonce-");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
  });

  it("keeps basic security headers on redirects", async () => {
    const res = await middleware(createMockRequest("/dashboard"));

    expect(res.status).toBe(307);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
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

  it("does not bootstrap a CSRF cookie for /api/csrf", async () => {
    const res = await middleware(createMockRequest("/api/csrf"));

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

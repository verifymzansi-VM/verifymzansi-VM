import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/supabase/playwright-session", () => ({
  PLAYWRIGHT_SESSION_COOKIE: "vmz_pw_session",
}));

vi.mock("@/lib/supabase/playwright-mode", () => ({
  isPlaywrightSupabaseStubMode: () => false,
}));

vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfCookie: (_req: NextRequest, _res: NextResponse) => "test-csrf-token",
  CSRF_HEADER_NAME: "x-csrf-token",
}));

vi.mock("@/lib/config/env", () => ({
  env: (key: string) => {
    const map: Record<string, string> = {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      R2_PUBLIC_URL: "https://cdn.example.com",
    };
    return map[key] ?? "";
  },
}));

import {
  generateNonce,
  shouldUseStrictNonceCsp,
  buildCsp,
  DEFAULT_PERMISSIONS_POLICY,
  applySecurityHeaders,
  withSecurityHeaders,
} from "@/lib/middleware/security-headers";

function createRequest(path: string, hostname = "localhost"): NextRequest {
  return new NextRequest(`http://${hostname}:3000${path}`);
}

describe("generateNonce", () => {
  it("returns a 32-character hex-like string without dashes", () => {
    const nonce = generateNonce();
    expect(nonce).toHaveLength(32);
    expect(nonce).not.toContain("-");
    expect(/^[0-9a-f]+$/.test(nonce)).toBe(true);
  });

  it("produces unique values per call", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });
});

describe("shouldUseStrictNonceCsp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(shouldUseStrictNonceCsp()).toBe(false);
  });

  it("returns true in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldUseStrictNonceCsp()).toBe(true);
  });
});

describe("buildCsp", () => {
  it("includes default-src, base-uri, frame-ancestors, and object-src", () => {
    const csp = buildCsp(null);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("uses unsafe-inline for scripts when no nonce but NOT unsafe-eval", () => {
    const csp = buildCsp(null);
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("uses nonce-based scripts with explicit URL allowlists when nonce provided", () => {
    const csp = buildCsp("abc123");
    expect(csp).toContain(
      "script-src 'self' 'nonce-abc123' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com"
    );
    expect(csp).not.toContain("'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
  });

  it("includes Supabase and CDN origins in connect-src and img-src", () => {
    const csp = buildCsp(null);
    expect(csp).toContain("https://test.supabase.co");
    expect(csp).toContain("https://cdn.example.com");
  });

  it("includes wss:// Supabase origin for Realtime WebSocket connections", () => {
    const csp = buildCsp(null);
    expect(csp).toContain("wss://test.supabase.co");
  });

  it("adds WebSocket sources when allowDevWebSocket is true", () => {
    const csp = buildCsp(null, { allowDevWebSocket: true });
    expect(csp).toContain("ws:");
    expect(csp).toContain("wss:");
  });

  it("does not add WebSocket sources when allowDevWebSocket is false", () => {
    const csp = buildCsp(null, { allowDevWebSocket: false });
    expect(csp).not.toContain("ws:");
  });

  it("adds upgrade-insecure-requests when enforceHttps is true", () => {
    const csp = buildCsp(null, { enforceHttps: true });
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("always includes report-to directive", () => {
    const csp = buildCsp(null);
    expect(csp).toContain("report-to csp-endpoint");
  });

  it("includes Sentry ingest in connect-src", () => {
    const csp = buildCsp(null);
    expect(csp).toContain("https://*.ingest.us.sentry.io");
  });

  it("includes Cloudflare Turnstile in frame-src and script-src", () => {
    const csp = buildCsp(null);
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("https://challenges.cloudflare.com");
  });
});

describe("applySecurityHeaders", () => {
  it("sets all required security headers", () => {
    const response = NextResponse.next();
    applySecurityHeaders(response, "default-src 'self'");

    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'self'");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Permissions-Policy")).toBe(DEFAULT_PERMISSIONS_POLICY);
    expect(response.headers.get("Report-To")).toContain("csp-endpoint");
  });

  it("uses custom permissions policy when provided", () => {
    const response = NextResponse.next();
    const custom = "camera=(self), microphone=()";
    applySecurityHeaders(response, "default-src 'self'", custom);

    expect(response.headers.get("Permissions-Policy")).toBe(custom);
  });

  it("adds HSTS in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = NextResponse.next();
    applySecurityHeaders(response, "default-src 'self'");

    expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
    vi.unstubAllEnvs();
  });

  it("does not add HSTS in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = NextResponse.next();
    applySecurityHeaders(response, "default-src 'self'");

    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("withSecurityHeaders", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("applies full CSP and CSRF to successful responses", () => {
    const request = createRequest("/");
    const proxyResponse = NextResponse.next();
    const response = withSecurityHeaders(request, proxyResponse);

    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(response.headers.get("set-cookie")).toContain("vm_csrf=");
  });

  it("applies only basic security headers to redirects", () => {
    const request = createRequest("/dashboard");
    const proxyResponse = NextResponse.redirect(new URL("/login", "http://localhost:3000"));
    const response = withSecurityHeaders(request, proxyResponse);

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    // Full CSP is not applied to redirects
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("applies only basic security headers to error responses", () => {
    const request = createRequest("/api/test");
    const proxyResponse = NextResponse.json({ error: "test" }, { status: 403 });
    const response = withSecurityHeaders(request, proxyResponse);

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("uses relaxed camera policy on /verification pages", () => {
    const request = createRequest("/verification/step-1");
    const proxyResponse = NextResponse.next();
    const response = withSecurityHeaders(request, proxyResponse);

    expect(response.headers.get("Permissions-Policy")).toContain("camera=(self)");
  });

  it("uses default restrictive camera policy on non-verification pages", () => {
    const request = createRequest("/dashboard");
    const proxyResponse = NextResponse.next();
    const response = withSecurityHeaders(request, proxyResponse);

    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it("pins immutable caching on public media proxy responses", () => {
    const request = createRequest("/api/media/serve/media/listing/example.jpg");
    const proxyResponse = NextResponse.next();
    const response = withSecurityHeaders(request, proxyResponse);

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("relaxes successful document caching away from no-store", () => {
    const request = createRequest("/");
    const proxyResponse = NextResponse.next();
    const response = withSecurityHeaders(request, proxyResponse);

    expect(response.headers.get("Cache-Control")).toBe("private, max-age=0, must-revalidate");
  });
});

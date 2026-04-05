import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/playwright-session", () => ({
  getPlaywrightStubUserFromToken: (token: string | null) => {
    if (!token) return null;
    const decoded = decodeURIComponent(token);
    if (decoded.startsWith("persona:")) {
      return {
        id: "stub-user-1",
        is_anonymous: false,
        app_metadata: { role: "seller" },
      };
    }
    return null;
  },
  PLAYWRIGHT_SESSION_COOKIE: "vmz_pw_session",
}));

vi.mock("@/lib/supabase/playwright-mode", () => ({
  isPlaywrightSupabaseStubMode: () => true,
}));

import {
  shouldUsePlaywrightStubForRequest,
  handlePlaywrightStubRouting,
} from "@/lib/middleware/playwright-stub";

const AUTH_ROUTES = ["/login", "/register"];
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/post",
  "/billing",
  "/verification",
  "/admin",
  "/api/dashboard",
  "/api/post",
  "/api/billing",
  "/api/verification",
  "/api/admin",
  "/api/otp",
];

function createRequest(
  path: string,
  options?: { hostname?: string; cookieHeader?: string }
): NextRequest {
  const hostname = options?.hostname ?? "localhost";
  const url = `http://${hostname}:3000${path}`;
  return new NextRequest(url, {
    headers: options?.cookieHeader ? { cookie: options.cookieHeader } : undefined,
  });
}

describe("shouldUsePlaywrightStubForRequest", () => {
  it("returns true for localhost", () => {
    const req = createRequest("/");
    expect(shouldUsePlaywrightStubForRequest(req)).toBe(true);
  });

  it("returns true for 127.0.0.1", () => {
    const req = createRequest("/", { hostname: "127.0.0.1" });
    expect(shouldUsePlaywrightStubForRequest(req)).toBe(true);
  });

  it("returns true for .test domains", () => {
    const req = createRequest("/", { hostname: "app.test" });
    expect(shouldUsePlaywrightStubForRequest(req)).toBe(true);
  });

  it("returns false for production hosts", () => {
    // isPlaywrightSupabaseStubMode() is mocked to return true, but
    // production hosts are blocked by the host check
    const req = createRequest("/", { hostname: "verifymzansi.com" });
    expect(shouldUsePlaywrightStubForRequest(req)).toBe(false);
  });
});

describe("handlePlaywrightStubRouting", () => {
  const origE2eAuth = process.env.PLAYWRIGHT_E2E_AUTH;

  beforeEach(() => {
    delete process.env.PLAYWRIGHT_E2E_AUTH;
  });

  afterEach(() => {
    if (origE2eAuth) process.env.PLAYWRIGHT_E2E_AUTH = origE2eAuth;
    else delete process.env.PLAYWRIGHT_E2E_AUTH;
  });

  it("returns null for non-stub hosts", () => {
    const req = createRequest("/dashboard", { hostname: "verifymzansi.com" });
    const result = handlePlaywrightStubRouting(req, PROTECTED_PREFIXES, AUTH_ROUTES);
    expect(result).toBeNull();
  });

  it("allows public pages through", () => {
    const req = createRequest("/mzansi-market");
    const result = handlePlaywrightStubRouting(req, PROTECTED_PREFIXES, AUTH_ROUTES);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(200);
  });

  it("allows auth routes through", () => {
    const req = createRequest("/login");
    const result = handlePlaywrightStubRouting(req, PROTECTED_PREFIXES, AUTH_ROUTES);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(200);
  });

  it("redirects unauthenticated users from protected pages to login", () => {
    const req = createRequest("/dashboard");
    const result = handlePlaywrightStubRouting(req, PROTECTED_PREFIXES, AUTH_ROUTES);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(307);
    const location = new URL(result!.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnUrl")).toBe("/dashboard");
  });

  it("returns 401 for unauthenticated API requests", () => {
    const req = createRequest("/api/otp/send");
    const result = handlePlaywrightStubRouting(req, PROTECTED_PREFIXES, AUTH_ROUTES);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("allows authenticated stub users to access protected pages", () => {
    process.env.PLAYWRIGHT_E2E_AUTH = "1";
    const req = createRequest("/dashboard", {
      cookieHeader: "vmz_pw_session=persona%3Aauthenticated",
    });
    const result = handlePlaywrightStubRouting(req, PROTECTED_PREFIXES, AUTH_ROUTES);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(200);
  });

  it("redirects authenticated stub users away from /login to /dashboard", () => {
    process.env.PLAYWRIGHT_E2E_AUTH = "1";
    const req = createRequest("/login", {
      cookieHeader: "vmz_pw_session=persona%3Aauthenticated",
    });
    const result = handlePlaywrightStubRouting(req, PROTECTED_PREFIXES, AUTH_ROUTES);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(307);
    expect(new URL(result!.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("blocks stub users from admin pages", () => {
    process.env.PLAYWRIGHT_E2E_AUTH = "1";
    const req = createRequest("/admin/users", {
      cookieHeader: "vmz_pw_session=persona%3Aauthenticated",
    });
    const result = handlePlaywrightStubRouting(req, PROTECTED_PREFIXES, AUTH_ROUTES);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(307);
    expect(new URL(result!.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("returns 403 for stub users on admin API routes", () => {
    process.env.PLAYWRIGHT_E2E_AUTH = "1";
    const req = createRequest("/api/admin/stats", {
      cookieHeader: "vmz_pw_session=persona%3Aauthenticated",
    });
    const result = handlePlaywrightStubRouting(req, PROTECTED_PREFIXES, AUTH_ROUTES);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});

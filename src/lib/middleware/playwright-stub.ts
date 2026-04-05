import { NextResponse, type NextRequest } from "next/server";
import {
  getPlaywrightStubUserFromToken,
  PLAYWRIGHT_SESSION_COOKIE,
} from "@/lib/supabase/playwright-session";
import { isPlaywrightSupabaseStubMode } from "@/lib/supabase/playwright-mode";

function isPlaywrightStubHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".test")
  );
}

export function shouldUsePlaywrightStubForRequest(request: NextRequest): boolean {
  return isPlaywrightSupabaseStubMode() && isPlaywrightStubHost(request.nextUrl.hostname);
}

/**
 * Handle routing for Playwright stub mode. Returns a response if the request
 * was handled, or null if the request should proceed through normal routing.
 */
export function handlePlaywrightStubRouting(
  request: NextRequest,
  protectedPrefixes: string[],
  authRoutes: string[]
): NextResponse | null {
  if (!shouldUsePlaywrightStubForRequest(request)) {
    return null;
  }

  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");

  const allowStubAuth = process.env.PLAYWRIGHT_E2E_AUTH === "1";
  const stubUser = allowStubAuth
    ? getPlaywrightStubUserFromToken(request.cookies.get(PLAYWRIGHT_SESSION_COOKIE)?.value ?? null)
    : null;
  const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
  const isAuthRoute = authRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  if (stubUser && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (!isProtected || isAuthRoute) {
    return NextResponse.next();
  }

  if (stubUser) {
    if (
      pathname === "/admin" ||
      pathname.startsWith("/admin/") ||
      pathname.startsWith("/api/admin/")
    ) {
      if (isApiRoute) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return NextResponse.next();
  }

  if (isApiRoute) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("returnUrl", pathname);
  return NextResponse.redirect(loginUrl);
}

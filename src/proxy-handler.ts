import { NextResponse, type NextRequest } from "next/server";
import { applySecurityHeaders, withSecurityHeaders } from "@/lib/middleware/security-headers";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { isAutomatedUserAgent } from "@/lib/analytics/automated-agent";
import postingTermsCatalogue from "@/lib/legal/terms-documents/catalogue.json";
import {
  createAnonymousViewerId,
  ENGAGEMENT_VIEWER_COOKIE,
  ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/engagement";

const logger = createLogger("Proxy");

// -- Route classification ----------------------------------------------------

const AUTH_ROUTES = ["/login", "/register"];

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/post",
  "/billing",
  "/verification",
  "/dsar",
  "/admin",
  "/staff",
  "/appeals",
  "/api/account",
  "/api/communications",
  "/api/content",
  "/api/drafts",
  "/api/dsar",
  "/api/dashboard",
  "/api/billing",
  "/api/verification",
  "/api/admin",
  "/api/appeals",
  "/api/otp",
  "/api/leads",
  "/api/media/upload",
  "/api/media/upload-complete",
  "/api/media/upload-url",
  "/api/notifications",
  "/api/profile",
];

// Public browse surfaces throttled to deter scraping.
const MARKETPLACE_BROWSE_PREFIXES = [
  "/listing/",
  "/mzansi-market",
  "/mzansi-business",
  "/tourism-events",
];

/**
 * Segment-boundary prefix match. A bare `startsWith` would let a route like
 * `/api/profileevil` match the protected prefix `/api/profile`. Matching on an
 * exact segment boundary (`/api/profile` or `/api/profile/...`) closes that
 * footgun for future route additions.
 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

// -- Core routing logic (testable without security headers) ------------------

/**
 * Internal routing function that handles auth checks, role gates,
 * and route protection. Exported separately for unit testing.
 */
export async function routeRequest(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");

  // Recover legacy signup links that land on "/?code=..." instead of the
  // dedicated auth callback route. Keep this scoped to the root path so
  // unrelated "code" params on other pages are not hijacked.
  if (request.method === "GET" && pathname === "/" && request.nextUrl.searchParams.has("code")) {
    const callbackUrl = new URL("/auth/callback", request.url);
    request.nextUrl.searchParams.forEach((value, key) => {
      callbackUrl.searchParams.set(key, value);
    });

    if (!callbackUrl.searchParams.has("next")) {
      callbackUrl.searchParams.set("next", "/login?confirmed=true");
    }

    return NextResponse.redirect(callbackUrl);
  }

  // Reject unknown immutable document paths before the request-dependent root
  // layout begins streaming, when notFound() can no longer set a 404 status.
  const termsPrefix = "/terms/versions";
  if (matchesPrefix(pathname, termsPrefix)) {
    const version = pathname.slice(termsPrefix.length + 1).replace(/\/$/, "");
    if (!Object.hasOwn(postingTermsCatalogue.versions, version))
      return new NextResponse("Not found", { status: 404 });
  }

  // Local design previews. The pages call notFound() themselves, but streaming
  // turns that into a 200 "not found" page, so answer with a real 404 here.
  if (
    matchesPrefix(pathname, "/dev") &&
    process.env.NODE_ENV === "production" &&
    !isPlaywrightTestMode()
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  // -- Guard: Supabase not configured ---------------------------------------
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const isProtected = PROTECTED_PREFIXES.some((p) => matchesPrefix(pathname, p));

    if (isProtected) {
      if (isApiRoute) {
        return NextResponse.json(
          { error: "Service misconfigured — authentication unavailable" },
          { status: 503 }
        );
      }
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  // -- Early exit for public routes ------------------------------------------

  const needsAuth =
    pathname === "/banned" ||
    PROTECTED_PREFIXES.some((p) => matchesPrefix(pathname, p)) ||
    AUTH_ROUTES.some((r) => matchesPrefix(pathname, r));

  // Rate-limit public marketplace pages to deter scraping.
  if (!needsAuth && MARKETPLACE_BROWSE_PREFIXES.some((p) => pathname.startsWith(p))) {
    const ip = getClientIp(request);
    const { limited, retryAfter } = checkLocalRateLimit(ip, "marketplace:browse", 60);
    if (limited) {
      return new NextResponse("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": String(retryAfter ?? 60) },
      });
    }
  }

  if (!needsAuth) {
    return NextResponse.next();
  }

  const { checkFoundationPageAccess } = await import("@/lib/foundation/page-access");
  return checkFoundationPageAccess(
    request,
    AUTH_ROUTES.some((route) => matchesPrefix(pathname, route))
  );
}

// -- Shared request handler -------------------------------------------------

/**
 * Shared Edge-safe request handler used by the framework entrypoint.
 * Delegates to routeRequest() for auth/routing, then wraps
 * the response with security headers (CSP nonce, HSTS, etc.).
 */
/**
 * Issue the anonymous browser identity on the first page load. Otherwise the
 * visit, view and impression beacons a new visitor fires in parallel each mint
 * their own ID, and one person counts as several visitors.
 */
function ensureViewerCookie(request: NextRequest, response: NextResponse): void {
  if (request.method !== "GET" || request.nextUrl.pathname.startsWith("/api/")) return;
  if (!request.headers.get("accept")?.includes("text/html")) return;
  if (request.cookies.get(ENGAGEMENT_VIEWER_COOKIE)?.value) return;
  if (response.headers.has("location") || response.status >= 400) return;
  if (isAutomatedUserAgent(request.headers.get("user-agent"))) return;
  response.cookies.set({
    name: ENGAGEMENT_VIEWER_COOKIE,
    value: createAnonymousViewerId(),
    maxAge: ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function handleMiddlewareRequest(request: NextRequest): Promise<NextResponse> {
  try {
    const routeResponse = await routeRequest(request);
    ensureViewerCookie(request, routeResponse);
    return withSecurityHeaders(request, routeResponse);
  } catch (error) {
    logger.error("Middleware request handler failed", {
      path: request.nextUrl.pathname,
      error: error instanceof Error ? error.message : String(error),
    });

    const pathname = request.nextUrl.pathname;
    const protectedPage = PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
    const fallback = pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 })
      : protectedPage
        ? new NextResponse("Service temporarily unavailable. Please try again shortly.", {
            status: 503,
          })
        : NextResponse.next();

    fallback.headers.set("Cache-Control", "no-store");

    if (fallback.status >= 400) {
      applySecurityHeaders(
        fallback,
        "default-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
      );
    } else {
      // A public pass-through still needs the normal forwarded nonce policy.
      // If header construction is what failed, degrade to the basic headers.
      try {
        return withSecurityHeaders(request, fallback);
      } catch {
        fallback.headers.set("X-Content-Type-Options", "nosniff");
        fallback.headers.set("X-Frame-Options", "DENY");
        fallback.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      }
    }

    return fallback;
  }
}

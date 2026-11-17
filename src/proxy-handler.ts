import { NextResponse, type NextRequest } from "next/server";
import { applySecurityHeaders, withSecurityHeaders } from "@/lib/middleware/security-headers";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { createLogger } from "@/lib/utils/logger";
import { addReferenceTiming } from "@/lib/utils/request-reference";
import { logRequestFailure } from "@/lib/utils/request-failure";
import { checkLocalRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { isAutomatedUserAgent } from "@/lib/analytics/automated-agent";
import { detailPageKeyIsMalformed, matchDetailPage } from "@/lib/routing/detail-pages";
import {
  dropIncomingFoundationPageSession,
  forwardFoundationPageSession,
} from "@/lib/foundation/page-session-handoff";
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
  "/api/notifications",
  "/api/profile",
];

// Public browse surfaces throttled to deter scraping.
const MARKETPLACE_BROWSE_PREFIXES = [
  "/listing/",
  "/mzansi-market",
  "/mzansi-business",
  "/tourism-events",
  // Organisation pages: the missing-page check below reads the database there too.
  "/organisation/",
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

/** Hosts that only redirect, permanently, to the site's one address. */
const REDIRECT_HOSTS: Readonly<Record<string, string>> = {
  "www.verifymzansi.com": "verifymzansi.com",
};

function redirectHostTarget(request: NextRequest): URL | null {
  for (const host of [request.headers.get("host"), request.nextUrl.host]) {
    const name = host?.trim().toLowerCase().replace(/:\d+$/, "");
    const apex = name ? REDIRECT_HOSTS[name] : undefined;
    if (apex) {
      const target = new URL(`https://${apex}`);
      target.pathname = request.nextUrl.pathname;
      target.search = request.nextUrl.search;
      return target;
    }
  }
  return null;
}

/** A browser or crawler loading the address, not the app's own in-page
 * navigation or prefetch (those read the page's data and handle "not found"
 * themselves). */
function isDocumentRequest(request: NextRequest): boolean {
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    !request.headers.has("rsc") &&
    !request.headers.has("next-router-prefetch")
  );
}

/** Render the page as usual but with HTTP 404, so it keeps its own "not
 * available" design while browsers, crawlers and link checkers see a real
 * 404 status (set before streaming starts). */
function notFoundPage(request: NextRequest): NextResponse {
  return NextResponse.rewrite(request.nextUrl.clone(), { status: 404 });
}

// -- Core routing logic (testable without security headers) ------------------

/**
 * Internal routing function that handles auth checks, role gates,
 * and route protection. Exported separately for unit testing.
 */
export async function routeRequest(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");

  // One address for the whole site: www.verifymzansi.com moves for good to
  // verifymzansi.com, keeping the path and query (308 keeps the method too).
  const hostTarget = redirectHostTarget(request);
  if (hostTarget) {
    return NextResponse.redirect(hostTarget, 308);
  }

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

  // The site has one set of Terms (/terms). Former per-version addresses,
  // including the links earlier posting forms showed, lead there for good.
  if (matchesPrefix(pathname, "/terms/versions")) {
    return NextResponse.redirect(new URL("/terms", request.url), 308);
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

  // Unknown posts and organisations, and the multi-listing page while packages
  // are not on sale. Their pages call notFound(), but streaming has already
  // sent 200 by then, so answer the 404 status here, before rendering. A
  // malformed address costs no read; a well-formed one costs one public read
  // (remembered for a minute when it exists), and a failed read lets the page
  // decide as before.
  if (!needsAuth && isDocumentRequest(request)) {
    const detailPage = matchDetailPage(pathname);
    if (detailPage) {
      if (detailPageKeyIsMalformed(detailPage)) return notFoundPage(request);
      const { isMissingDetailPage } = await import("@/lib/foundation/missing-detail-page");
      if (await isMissingDetailPage(detailPage)) return notFoundPage(request);
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
  // Only the page gate may hand a verified account to the page render.
  dropIncomingFoundationPageSession(request);
  try {
    const routeResponse = await routeRequest(request);
    ensureViewerCookie(request, routeResponse);
    addReferenceTiming(request, routeResponse);
    return forwardFoundationPageSession(request, withSecurityHeaders(request, routeResponse));
  } catch (error) {
    const reference = logRequestFailure(logger, "Middleware request handler failed", {
      request,
      error,
    });

    const pathname = request.nextUrl.pathname;
    const protectedPage = PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
    const fallback = pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Service temporarily unavailable", reference }, { status: 503 })
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
        return forwardFoundationPageSession(request, withSecurityHeaders(request, fallback));
      } catch {
        fallback.headers.set("X-Content-Type-Options", "nosniff");
        fallback.headers.set("X-Frame-Options", "DENY");
        fallback.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      }
    }

    return forwardFoundationPageSession(request, fallback);
  }
}

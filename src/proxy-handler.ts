import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { withSecurityHeaders } from "@/lib/middleware/security-headers";
import { handlePlaywrightStubRouting } from "@/lib/middleware/playwright-stub";
import {
  checkPhoneGate,
  checkAdminGate,
  checkBanEnforcement,
  checkPostingGate,
  type CachedProfile,
} from "@/lib/middleware/auth-gates";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit, getClientIp } from "@/lib/utils/rate-limit";

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
  "/api/account",
  "/api/communications",
  "/api/content",
  "/api/drafts",
  "/api/dsar",
  "/api/dashboard",
  "/api/billing",
  "/api/verification",
  "/api/admin",
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

  // -- Playwright stub mode --------------------------------------------------
  const playwrightResult = handlePlaywrightStubRouting(request, PROTECTED_PREFIXES, AUTH_ROUTES);
  if (playwrightResult) {
    return playwrightResult;
  }

  // -- Guard: Supabase not configured ---------------------------------------
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

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
    PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) ||
    AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

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

  // -- Supabase client -------------------------------------------------------

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  // Track cookies set by the Supabase client (token refresh, etc.) so they
  // can be forwarded onto redirect responses that would otherwise drop them.
  const pendingCookies: Array<{ name: string; value: string; options: CookieOptions }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value, ...options });
          pendingCookies.push({ name, value, options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value: "", ...options });
          pendingCookies.push({ name, value: "", options });
        },
      },
    }
  );

  /** Create a redirect that preserves any cookies set during this request. */
  function redirectWithCookies(url: URL | string): NextResponse {
    const target = typeof url === "string" ? new URL(url, request.url) : url;
    const redir = NextResponse.redirect(target);
    for (const { name, value, options } of pendingCookies) {
      redir.cookies.set({ name, value, ...options });
    }
    return redir;
  }

  function clearStaleSupabaseAuthCookies(target: NextResponse): void {
    for (const cookie of request.cookies.getAll()) {
      const name = cookie.name;
      if (!name.startsWith("sb-") || !name.includes("auth-token")) {
        continue;
      }

      target.cookies.set({
        name,
        value: "",
        path: "/",
        maxAge: 0,
      });
      pendingCookies.push({ name, value: "", options: { path: "/", maxAge: 0 } });
    }
  }

  function isInvalidRefreshTokenError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error
          ? String((error as { message?: unknown }).message)
          : String(error ?? "");

    const normalized = message.toLowerCase();
    return (
      normalized.includes("refresh token") ||
      normalized.includes("authsessionmissing") ||
      normalized.includes("auth session missing")
    );
  }

  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      if (isInvalidRefreshTokenError(error)) {
        clearStaleSupabaseAuthCookies(response);
        user = null;
      } else {
        throw error;
      }
    } else {
      user = data.user;
    }
  } catch (error) {
    const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
    if (isProtected) {
      if (isApiRoute) {
        const unavailable = NextResponse.json(
          { error: "Authentication service unavailable" },
          { status: 503 }
        );
        if (isInvalidRefreshTokenError(error)) {
          clearStaleSupabaseAuthCookies(unavailable);
        }
        return unavailable;
      }
      const redirect = redirectWithCookies(new URL("/login?error=auth_unavailable", request.url));
      if (isInvalidRefreshTokenError(error)) {
        clearStaleSupabaseAuthCookies(redirect);
      }
      return redirect;
    }
    return response;
  }

  // -- Auth routes: redirect logged-in (real) users away --------------------
  const isRealUser = user && user.is_anonymous !== true;
  if (isRealUser && AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
    return redirectWithCookies(new URL("/", request.url));
  }

  // -- Consolidated profile cache -------------------------------------------
  let cachedProfile: CachedProfile = null;

  // -- Phone-missing gate ---------------------------------------------------
  if (isRealUser && user) {
    const phoneResult = await checkPhoneGate(
      request,
      response,
      supabase,
      user.id,
      cachedProfile,
      redirectWithCookies
    );
    cachedProfile = phoneResult.profile;
    if (phoneResult.response) {
      return phoneResult.response;
    }
  }

  // -- Protected routes: require authentication -----------------------------
  const isProtectedRoute = PROTECTED_PREFIXES.filter(
    (prefix) => prefix !== "/admin" && prefix !== "/api/admin"
  ).some((p) => pathname.startsWith(p));
  const protectedReturnUrl = `${pathname}${request.nextUrl.search}`;

  if (!user && isProtectedRoute) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnUrl", protectedReturnUrl);
    return redirectWithCookies(loginUrl);
  }

  // Block anonymous Supabase sessions from accessing protected routes
  if (user?.is_anonymous && isProtectedRoute) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnUrl", protectedReturnUrl);
    return redirectWithCookies(loginUrl);
  }

  // -- Admin gate -----------------------------------------------------------
  const adminResult = checkAdminGate(request, user, redirectWithCookies);
  if (adminResult) {
    return adminResult;
  }

  // -- Ban/suspension enforcement -------------------------------------------
  if (user) {
    const banResult = await checkBanEnforcement(
      request,
      supabase,
      user.id,
      isProtectedRoute,
      cachedProfile,
      redirectWithCookies
    );
    cachedProfile = banResult.profile;
    if (banResult.response) {
      return banResult.response;
    }
  }

  // -- Posting gate ---------------------------------------------------------
  if (user) {
    const postingResult = await checkPostingGate(
      request,
      supabase,
      user.id,
      cachedProfile,
      redirectWithCookies
    );
    cachedProfile = postingResult.profile;
    if (postingResult.response) {
      return postingResult.response;
    }
  }

  return response;
}

// -- Shared request handler -------------------------------------------------

/**
 * Shared Edge-safe request handler used by the framework entrypoint.
 * Delegates to routeRequest() for auth/routing, then wraps
 * the response with security headers (CSP nonce, HSTS, etc.).
 */
export async function handleMiddlewareRequest(request: NextRequest): Promise<NextResponse> {
  try {
    const routeResponse = await routeRequest(request);
    return withSecurityHeaders(request, routeResponse);
  } catch (error) {
    logger.error("Middleware request handler failed", {
      path: request.nextUrl.pathname,
      error: error instanceof Error ? error.message : String(error),
    });

    const fallback = request.nextUrl.pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 })
      : NextResponse.next();

    fallback.headers.set("X-Content-Type-Options", "nosniff");
    fallback.headers.set("X-Frame-Options", "DENY");
    fallback.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    return fallback;
  }
}

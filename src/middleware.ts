import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isModeratorOrAdmin } from "@/lib/auth/roles";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("Middleware");

// ── Security helpers ────────────────────────────────────────

/** Generate a per-request CSP nonce. */
function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/** Build a nonce-based Content-Security-Policy string. */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tnygdgormnofpgjknlhr.supabase.co https://media.verifymzansi.co.za https://*.r2.cloudflarestorage.com https://storage.googleapis.com",
    "media-src 'self' blob: https://media.verifymzansi.co.za https://*.r2.cloudflarestorage.com https://storage.googleapis.com",
    "font-src 'self'",
    "connect-src 'self' https://tnygdgormnofpgjknlhr.supabase.co https://*.sentry.io https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "form-action 'self'",
    "worker-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Attach all standard security headers to a response. */
function applySecurityHeaders(response: NextResponse, csp: string): void {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self), payment=(), usb=(), magnetometer=(), gyroscope=()"
  );

  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }
}

/**
 * Wrap a proxy result with CSP nonce + security headers.
 * Redirects and error responses get basic security headers only.
 */
function withSecurityHeaders(request: NextRequest, proxyResponse: NextResponse): NextResponse {
  if (proxyResponse.headers.has("location") || proxyResponse.status >= 400) {
    proxyResponse.headers.set("X-Content-Type-Options", "nosniff");
    proxyResponse.headers.set("X-Frame-Options", "DENY");
    proxyResponse.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return proxyResponse;
  }

  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Inject x-nonce so Server Components can read it via `headers()`
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Preserve cookies set during auth (Supabase session refresh, etc.)
  for (const cookie of proxyResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }

  applySecurityHeaders(response, csp);

  return response;
}

// ── Core routing logic (testable without security headers) ──

/**
 * Internal routing function that handles auth checks, role gates,
 * and route protection. Exported separately for unit testing.
 */
export async function routeRequest(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");

  // ── Guard: Supabase not configured ────────────────────────
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const protectedPrefixes = [
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
    ];
    const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));

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

  // ── Supabase client ───────────────────────────────────────

  // Determine early whether this route needs authentication at all.
  // Public routes (home, marketplace, terms, etc.) skip the Supabase
  // getUser() call entirely — saving 100-300 ms on mobile networks.
  const authRoutes = ["/login", "/register"];
  const protectedPrefixesAll = [
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
  const needsAuth =
    protectedPrefixesAll.some((p) => pathname.startsWith(p)) ||
    authRoutes.some((r) => pathname === r || pathname.startsWith(r + "/"));

  if (!needsAuth) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

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
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Auth check failed — deny access to protected routes to prevent
    // unguarded access during Supabase outages.
    const protectedPrefixes = [
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
    ];
    const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));
    if (isProtected) {
      if (isApiRoute) {
        return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
      }
      return NextResponse.redirect(new URL("/login?error=auth_unavailable", request.url));
    }
    return response;
  }

  // ── Auth routes: redirect logged-in (real) users away ────
  const isRealUser = user && user.is_anonymous !== true;
  if (isRealUser && authRoutes.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // ── Protected routes: require authentication ─────────────
  const protectedPrefixes = [
    "/dashboard",
    "/post",
    "/billing",
    "/verification",
    "/api/dashboard",
    "/api/post",
    "/api/billing",
    "/api/verification",
  ];
  const isProtectedRoute = protectedPrefixes.some((p) => pathname.startsWith(p));

  if (!user && isProtectedRoute) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Block anonymous Supabase sessions from accessing protected routes
  if (user?.is_anonymous && isProtectedRoute) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Admin routes: require admin/moderator role ───────────
  if (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/admin/")
  ) {
    if (!user) {
      if (isApiRoute) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (!isModeratorOrAdmin(user)) {
      if (isApiRoute) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  // ── Seller gating: require verified seller for posting ───
  if (
    pathname.startsWith("/post/create") ||
    pathname.startsWith("/post/edit") ||
    pathname.startsWith("/api/post/create") ||
    pathname.startsWith("/api/post/edit")
  ) {
    if (user) {
      const { data: profile, error: profileError } = await supabase
        .from("seller_profiles")
        .select("seller_verification_status, account_status, suspended_until")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profileError) {
        logger.error("Seller profile lookup failed during posting gate", {
          path: pathname,
          userId: user.id,
          error: profileError.message,
          code: profileError.code,
        });

        if (isApiRoute) {
          return NextResponse.json(
            { error: "Posting eligibility service unavailable" },
            { status: 503 }
          );
        }

        return NextResponse.redirect(new URL("/dashboard", request.url));
      }

      if (profile?.account_status === "banned") {
        if (isApiRoute) return NextResponse.json({ error: "Banned" }, { status: 403 });
        return NextResponse.redirect(new URL("/banned", request.url));
      }

      if (profile?.account_status === "suspended") {
        if (profile.suspended_until && new Date(profile.suspended_until) <= new Date()) {
          try {
            await supabase
              .from("seller_profiles")
              .update({ account_status: "active", suspended_until: null })
              .eq("user_id", user.id);
          } catch {
            // Auto-unsuspend failed — still allow the request so the user
            // isn't permanently locked out; the next request will retry.
          }
        } else {
          if (isApiRoute) return NextResponse.json({ error: "Suspended" }, { status: 403 });
          return NextResponse.redirect(new URL("/dashboard", request.url));
        }
      }

      if (profile?.seller_verification_status !== "verified") {
        if (isApiRoute)
          return NextResponse.json({ error: "Verification required" }, { status: 403 });
        return NextResponse.redirect(new URL("/verification", request.url));
      }
    }
  }

  return response;
}

// ── Next.js middleware entry point ───────────────────────────

/**
 * Edge middleware called by Next.js on every matched request.
 * Delegates to routeRequest() for auth/routing, then wraps
 * the response with security headers (CSP nonce, HSTS, etc.).
 *
 * TODO(cloudflare-next16): Move this to `proxy.ts` only after the
 * Cloudflare/OpenNext adapter supports the Next.js 16 Node proxy runtime.
 * Until then, keep the middleware convention despite the deprecation warning.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const routeResponse = await routeRequest(request);
  return withSecurityHeaders(request, routeResponse);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/webhooks).*)"],
};

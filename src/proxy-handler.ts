import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import { summarizeVerification } from "@/lib/account/verification-summary";
import { isModeratorOrAdmin } from "@/lib/auth/roles";
import {
  getPlaywrightStubUserFromToken,
  PLAYWRIGHT_SESSION_COOKIE,
} from "@/lib/supabase/playwright-session";
import { isPlaywrightSupabaseStubMode } from "@/lib/supabase/playwright-mode";
import { ensureCsrfCookie, CSRF_HEADER_NAME } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("Proxy");

// -- Security helpers --------------------------------------------------------

/** Generate a per-request CSP nonce. */
function generateNonce(): string {
  // Avoid runtime-specific globals (e.g. btoa) so nonce generation is stable
  // across Cloudflare/workerd and Node-compatible environments.
  return crypto.randomUUID().replace(/-/g, "");
}

function shouldUseStrictNonceCsp(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Build a nonce-based Content-Security-Policy string. */
function buildCsp(
  nonce: string | null,
  options?: { allowDevWebSocket?: boolean; enforceHttps?: boolean }
): string {
  const connectSrcValues = [
    "'self'",
    "https://tnygdgormnofpgjknlhr.supabase.co",
    "https://*.ingest.us.sentry.io",
    "https://challenges.cloudflare.com",
    "https://*.r2.cloudflarestorage.com",
  ];

  if (options?.allowDevWebSocket) {
    connectSrcValues.splice(1, 0, "ws:", "wss:");
  }

  const connectSrc = `connect-src ${connectSrcValues.join(" ")}`;
  const scriptSrc = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com`
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com";
  const styleSrc = nonce ? `style-src 'self' 'nonce-${nonce}'` : "style-src 'self' 'unsafe-inline'";
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    scriptSrc,
    styleSrc,
    // React/Next components such as next/image emit inline style attributes
    // for layout-critical positioning. Keep style tags nonce-bound, but allow
    // style attributes so media and responsive UI render under the production CSP.
    ...(nonce ? ["style-src-attr 'unsafe-inline'"] : []),
    "img-src 'self' blob: https://tnygdgormnofpgjknlhr.supabase.co https://media.verifymzansi.com https://*.r2.cloudflarestorage.com https://images.unsplash.com https://storage.googleapis.com",
    "media-src 'self' blob: https://media.verifymzansi.com https://*.r2.cloudflarestorage.com https://storage.googleapis.com",
    "font-src 'self'",
    connectSrc,
    "frame-src https://challenges.cloudflare.com",
    "form-action 'self'",
    "worker-src 'self'",
  ];

  if (options?.enforceHttps) {
    directives.push("upgrade-insecure-requests");
  }

  directives.push("report-to csp-endpoint");

  return directives.join("; ");
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
  response.headers.set(
    "Report-To",
    JSON.stringify({
      group: "csp-endpoint",
      max_age: 86400,
      endpoints: [{ url: "/api/csp-report" }],
    })
  );

  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }
}

function setPhoneOkCookie(response: NextResponse): void {
  response.cookies.set("x-phone-ok", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 86400,
    path: "/",
  });
}

function clearPhoneOkCookie(response: NextResponse): void {
  response.cookies.delete("x-phone-ok");
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

  const nonce = shouldUseStrictNonceCsp() ? generateNonce() : null;
  const isSecureRequest =
    request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const csp = buildCsp(nonce, {
    allowDevWebSocket: process.env.NODE_ENV !== "production",
    enforceHttps: isSecureRequest,
  });

  // Inject x-nonce so Server Components can read it via `headers()`
  const requestHeaders = new Headers(request.headers);
  if (nonce) {
    requestHeaders.set("x-nonce", nonce);
  } else {
    requestHeaders.delete("x-nonce");
  }
  requestHeaders.set("Content-Security-Policy", csp);

  // Build a temporary response to let ensureCsrfCookie resolve the token
  // (reads existing cookie or generates a new one), then forward the token
  // as a request header so Server Components can inject it via <meta>.
  const csrfResponse = NextResponse.next();
  const csrfToken = ensureCsrfCookie(request, csrfResponse);
  requestHeaders.set(CSRF_HEADER_NAME, csrfToken);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Transfer the CSRF cookie from the temporary response
  const csrfCookie = csrfResponse.cookies.get("vm_csrf");
  if (csrfCookie) {
    response.cookies.set(csrfCookie);
  }

  // Preserve cookies set during auth (Supabase session refresh, etc.)
  for (const cookie of proxyResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }

  // Preserve any non-cookie headers the routing layer already attached.
  for (const [headerName, headerValue] of proxyResponse.headers.entries()) {
    const normalizedHeaderName = headerName.toLowerCase();
    if (
      normalizedHeaderName === "content-security-policy" ||
      normalizedHeaderName === "x-nonce" ||
      normalizedHeaderName === "set-cookie"
    ) {
      continue;
    }

    response.headers.set(headerName, headerValue);
  }

  applySecurityHeaders(response, csp);
  if (nonce) {
    response.headers.set("x-nonce", nonce);
  }

  return response;
}

// -- Core routing logic (testable without security headers) ------------------

/**
 * Internal routing function that handles auth checks, role gates,
 * and route protection. Exported separately for unit testing.
 */
export async function routeRequest(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");
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
  const protectedPrefixes = protectedPrefixesAll.filter((p) => p !== "/api/otp");

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

  if (isPlaywrightSupabaseStubMode()) {
    const stubUser =
      process.env.PLAYWRIGHT_E2E_AUTH === "1"
        ? getPlaywrightStubUserFromToken(
            request.cookies.get(PLAYWRIGHT_SESSION_COOKIE)?.value ?? null
          )
        : null;
    const isProtected = protectedPrefixesAll.some((prefix) => pathname.startsWith(prefix));
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

  // -- Guard: Supabase not configured ---------------------------------------
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
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

  // -- Supabase client -------------------------------------------------------

  // Determine early whether this route needs authentication at all.
  // Public routes (home, marketplace, terms, etc.) skip the Supabase
  // getUser() call entirely — saving 100-300 ms on mobile networks.
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
    const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));
    if (isProtected) {
      if (isApiRoute) {
        return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
      }
      return NextResponse.redirect(new URL("/login?error=auth_unavailable", request.url));
    }
    return response;
  }

  // -- Auth routes: redirect logged-in (real) users away --------------------
  const isRealUser = user && user.is_anonymous !== true;
  if (isRealUser && authRoutes.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // -- Consolidated profile query ------------------------------------------------
  // Phone gate, ban/suspension enforcement, and posting gate all query
  // account_profiles by user_id.  We consolidate them into a single query
  // to eliminate redundant DB round-trips on every authenticated request.
  //
  // The result is cached in `cachedProfile` and reused by all three gates.
  let cachedProfile: {
    phone?: string | null;
    account_status?: string | null;
    suspended_until?: string | null;
    account_verification_status?: string | null;
  } | null = null;

  // -- Phone-missing gate: require phone number on profile --------------------
  // OAuth users may have an account profile without a phone number.
  // Redirect them to complete-profile so they add one before using the platform.
  //
  const phoneGatedPrefixes = ["/dashboard", "/post", "/billing", "/verification"];
  const isPhoneGatedRoute = phoneGatedPrefixes.some((p) => pathname.startsWith(p));
  const isCompleteProfileRoute = pathname === "/dashboard/complete-profile";

  if (isRealUser && user && isPhoneGatedRoute && !isCompleteProfileRoute && !isApiRoute) {
    try {
      const { data: phoneProfile } = await supabase
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .select("phone, account_status, suspended_until, account_verification_status")
        .eq("user_id", user.id)
        .maybeSingle();

      cachedProfile = phoneProfile;

      if (!phoneProfile?.phone) {
        const completeProfileUrl = new URL("/dashboard/complete-profile", request.url);
        completeProfileUrl.searchParams.set("returnUrl", pathname);
        const redirect = NextResponse.redirect(completeProfileUrl);
        clearPhoneOkCookie(redirect);
        return redirect;
      }

      setPhoneOkCookie(response);
    } catch (phoneGateErr) {
      // Fail closed: if we can't verify phone, redirect to error page.
      logger.error("Phone gate DB check failed — redirecting to error page", {
        path: pathname,
        userId: user.id,
        error: phoneGateErr instanceof Error ? phoneGateErr.message : "Unknown",
      });
      return NextResponse.redirect(new URL("/error?reason=unavailable", request.url));
    }
  }

  // -- Protected routes: require authentication -----------------------------
  const isProtectedRoute = protectedPrefixes
    .filter((prefix) => prefix !== "/admin" && prefix !== "/api/admin")
    .some((p) => pathname.startsWith(p));
  const protectedReturnUrl = `${pathname}${request.nextUrl.search}`;

  if (!user && isProtectedRoute) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnUrl", protectedReturnUrl);
    return NextResponse.redirect(loginUrl);
  }

  // Block anonymous Supabase sessions from accessing protected routes
  if (user?.is_anonymous && isProtectedRoute) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnUrl", protectedReturnUrl);
    return NextResponse.redirect(loginUrl);
  }

  // -- Admin routes: require admin/moderator role ---------------------------
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

  // -- Ban/suspension enforcement: block banned/suspended users from all protected routes --
  // Also enforce on authenticated mutation API requests (POST/PUT/PATCH/DELETE)
  // to prevent banned users from creating/modifying content via unprotected API routes.
  const isMutationRequest = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  const isBanEnforced = isProtectedRoute || (isApiRoute && isMutationRequest);
  if (user && isBanEnforced) {
    // Reuse the consolidated profile query from the phone gate if available;
    // otherwise fetch the needed columns now (e.g. API routes skip the phone gate).
    let statusProfile = cachedProfile;
    if (!statusProfile) {
      const { data, error: statusError } = await supabase
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .select("account_status, suspended_until, account_verification_status")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!statusError) {
        statusProfile = data;
        cachedProfile = data;
      } else {
        logger.error("Ban enforcement DB check failed — blocking access", {
          userId: user.id,
          error: statusError.message,
          code: statusError.code,
          path: pathname,
        });
        if (isApiRoute) {
          return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
        }
        return NextResponse.redirect(new URL("/error", request.url));
      }
    }

    if (statusProfile) {
      if (statusProfile.account_status === "banned") {
        if (isApiRoute) return NextResponse.json({ error: "Banned" }, { status: 403 });
        return NextResponse.redirect(new URL("/banned", request.url));
      }

      if (statusProfile.account_status === "suspended") {
        if (
          statusProfile.suspended_until &&
          new Date(statusProfile.suspended_until) <= new Date()
        ) {
          try {
            await supabase
              .from(ACCOUNT_PROFILE_WRITE_TABLE)
              .update({ account_status: "active", suspended_until: null })
              .eq("user_id", user.id);
          } catch (unsuspendErr) {
            // Auto-unsuspend failed — still allow the request so the user
            // isn't permanently locked out; the next request will retry.
            logger.error("Auto-unsuspend DB update failed — user will retry on next request", {
              userId: user.id,
              error: unsuspendErr instanceof Error ? unsuspendErr.message : "Unknown",
            });
          }
        } else {
          // Avoid redirect loop: if already on /dashboard with ?suspended, let it through
          if (
            pathname === "/dashboard" &&
            request.nextUrl.searchParams.get("suspended") === "true"
          ) {
            return response;
          }
          if (isApiRoute) return NextResponse.json({ error: "Suspended" }, { status: 403 });
          const suspendedUrl = new URL("/dashboard", request.url);
          suspendedUrl.searchParams.set("suspended", "true");
          if (statusProfile.suspended_until) {
            suspendedUrl.searchParams.set("until", statusProfile.suspended_until);
          }
          return NextResponse.redirect(suspendedUrl);
        }
      }
    }
  }

  // -- Posting gate: require a verified account for posting -----------------
  // /post/create is the category-selection page — it handles unverified users
  // in-client (shows a verification alert + redirects category links to
  // /verification). Only the actual creation/edit sub-routes need gating.
  const isPostingRoute =
    (pathname.startsWith("/post/create") && pathname !== "/post/create") ||
    pathname.startsWith("/post/edit") ||
    pathname.startsWith("/api/post/create") ||
    pathname.startsWith("/api/post/edit");
  if (isPostingRoute) {
    if (user) {
      // Reuse the consolidated profile from phone gate / ban check if available.
      let profile = cachedProfile;
      let profileError: { message: string; code?: string } | null = null;

      if (!profile) {
        const { data, error } = await supabase
          .from(ACCOUNT_PROFILE_WRITE_TABLE)
          .select("account_verification_status, account_status, suspended_until")
          .eq("user_id", user.id)
          .maybeSingle();

        profile = data;
        profileError = error;
        cachedProfile = data;
      }

      if (profileError) {
        logger.error("Account profile lookup failed in posting gate", {
          path: pathname,
          userId: user.id,
          error: profileError.message,
          code: profileError.code,
        });
      }

      if (profile?.account_status === "banned") {
        if (isApiRoute) return NextResponse.json({ error: "Banned" }, { status: 403 });
        return NextResponse.redirect(new URL("/banned", request.url));
      }

      if (profile?.account_status === "suspended") {
        if (profile.suspended_until && new Date(profile.suspended_until) <= new Date()) {
          try {
            await supabase
              .from(ACCOUNT_PROFILE_WRITE_TABLE)
              .update({ account_status: "active", suspended_until: null })
              .eq("user_id", user.id);

            // Content restoration is NOT done here. The previous approach
            // restored ALL hidden content, which incorrectly un-hid items
            // hidden by admin moderation for other reasons (e.g. reported
            // content hidden before/independently of the suspension).
            // Content is restored via the admin enforcement unban flow
            // (enforceAction with action="unban"), which scopes restoration
            // to items hidden after the suspension timestamp.
          } catch (unsuspendErr2) {
            // Auto-unsuspend failed — still allow the request so the user
            // isn't permanently locked out; the next request will retry.
            logger.error(
              "Auto-unsuspend DB update failed in posting gate — user will retry on next request",
              {
                userId: user.id,
                error: unsuspendErr2 instanceof Error ? unsuspendErr2.message : "Unknown",
              }
            );
          }
        } else {
          if (isApiRoute) return NextResponse.json({ error: "Suspended" }, { status: 403 });
          const suspendedUrl = new URL("/dashboard", request.url);
          suspendedUrl.searchParams.set("suspended", "true");
          if (profile.suspended_until) {
            suspendedUrl.searchParams.set("until", profile.suspended_until);
          }
          return NextResponse.redirect(suspendedUrl);
        }
      }

      let canPost = readAccountVerificationStatus(profile) === "verified";

      if (!canPost) {
        const { data: verificationSteps, error: verificationStepsError } = await supabase
          .from("verification_steps")
          .select("step_type, status")
          .eq("user_id", user.id);

        if (verificationStepsError) {
          logger.error("Verification step lookup failed in posting gate", {
            path: pathname,
            userId: user.id,
            error: verificationStepsError.message,
            code: verificationStepsError.code,
          });
        }

        canPost =
          summarizeVerification(profile?.account_verification_status, verificationSteps ?? [])
            .accountVerificationStatus === "verified";
      }

      if (!canPost) {
        if (isApiRoute) {
          return NextResponse.json({ error: "Verification required" }, { status: 403 });
        }
        const verificationUrl = new URL("/verification", request.url);
        verificationUrl.searchParams.set("returnUrl", pathname);
        return NextResponse.redirect(verificationUrl);
      }
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

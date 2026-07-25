import { NextResponse, type NextRequest } from "next/server";
import { ensureCsrfCookie, CSRF_HEADER_NAME } from "@/lib/utils/csrf";
import { env } from "@/lib/config/env";
import { PLAYWRIGHT_SESSION_COOKIE } from "@/lib/supabase/playwright-session";
import { shouldUsePlaywrightStubForRequest } from "@/lib/middleware/playwright-stub";

// -- Nonce & CSP helpers -----------------------------------------------------

/** Generate a per-request CSP nonce. */
export function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function shouldUseStrictNonceCsp(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Build a nonce-based Content-Security-Policy string. */
export function buildCsp(
  nonce: string | null,
  options?: { allowDevWebSocket?: boolean; enforceHttps?: boolean }
): string {
  const supabaseOrigin = env("NEXT_PUBLIC_SUPABASE_URL") ?? "";
  const cdnOrigin = env("R2_PUBLIC_URL") ?? "";

  // Supabase Realtime uses WebSockets — derive wss:// origin so the CSP
  // connect-src allows the upgrade.  Without this iOS Safari throws
  // SecurityError("The operation is insecure") and the app crashes.
  let supabaseWsOrigin = "";
  if (supabaseOrigin) {
    try {
      const u = new URL(supabaseOrigin);
      supabaseWsOrigin = `wss://${u.host}`;
    } catch {
      /* invalid URL – skip */
    }
  }

  const connectSrcValues = [
    "'self'",
    ...(supabaseOrigin ? [supabaseOrigin] : []),
    ...(supabaseWsOrigin ? [supabaseWsOrigin] : []),
    "https://*.ingest.us.sentry.io",
    "https://challenges.cloudflare.com",
    "https://static.cloudflareinsights.com",
    "https://unpkg.com",
    "https://*.r2.cloudflarestorage.com",
  ];

  if (options?.allowDevWebSocket) {
    connectSrcValues.splice(1, 0, "ws:", "wss:");
  }

  const connectSrc = `connect-src ${connectSrcValues.join(" ")}`;
  // NOTE: 'strict-dynamic' is intentionally omitted. Cloudflare's edge
  // auto-injects scripts (Web Analytics beacon, Bot Management challenge-
  // platform) that cannot receive a nonce. With 'strict-dynamic' those
  // scripts are blocked because URL allowlists are ignored. Using nonce +
  // explicit URL allowlists gives strong XSS protection while remaining
  // compatible with Cloudflare's infrastructure.
  const scriptSrc = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://unpkg.com`
    : "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://unpkg.com";
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
    `img-src 'self' blob:${supabaseOrigin ? " " + supabaseOrigin : ""}${cdnOrigin ? " " + cdnOrigin : ""} https://*.r2.cloudflarestorage.com https://images.unsplash.com https://storage.googleapis.com`,
    `media-src 'self' blob:${cdnOrigin ? " " + cdnOrigin : ""} https://*.r2.cloudflarestorage.com https://storage.googleapis.com`,
    "font-src 'self'",
    connectSrc,
    "frame-src https://challenges.cloudflare.com",
    "form-action 'self'",
    "worker-src 'self' blob:",
  ];

  if (options?.enforceHttps) {
    directives.push("upgrade-insecure-requests");
  }

  directives.push("report-to csp-endpoint");

  return directives.join("; ");
}

// -- Permissions policy ------------------------------------------------------

export const DEFAULT_PERMISSIONS_POLICY =
  // Permissions Policy is bound to the top-level document for the lifetime of
  // the SPA session. Users often enter verification after loading /login or
  // another route first, so camera must be allowed for same-origin documents up
  // front or the browser blocks getUserMedia without showing a prompt.
  "camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), magnetometer=(), gyroscope=()";

// -- Header application -----------------------------------------------------

function isCacheableAssetRequest(pathname: string): boolean {
  return pathname.startsWith("/api/media/serve/") || pathname.startsWith("/images/");
}

function shouldSkipCsrfBootstrap(pathname: string): boolean {
  return pathname === "/api/csrf" || isCacheableAssetRequest(pathname);
}

function getAssetCacheControl(pathname: string): string | null {
  if (pathname.startsWith("/api/media/serve/")) {
    return "public, max-age=31536000, immutable";
  }

  if (pathname.startsWith("/images/")) {
    return "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
  }

  return null;
}

function shouldRelaxDocumentCache(pathname: string): boolean {
  return !pathname.startsWith("/api/") && !pathname.startsWith("/_next/");
}

function shouldPreventApiCaching(pathname: string): boolean {
  return pathname.startsWith("/api/") && !isCacheableAssetRequest(pathname);
}

function applyNoStoreCacheControl(response: NextResponse): void {
  response.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
}

/** Attach all standard security headers to a response. */
export function applySecurityHeaders(
  response: NextResponse,
  csp: string,
  permissionsPolicy: string = DEFAULT_PERMISSIONS_POLICY
): void {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", permissionsPolicy);
  // The Reporting API requires absolute endpoint URLs — a relative path is
  // silently ignored and CSP reports are never delivered.
  const appUrl = (env("NEXT_PUBLIC_APP_URL") ?? "").replace(/\/+$/, "");
  const cspReportUrl = `${appUrl}/api/csp-report`;
  response.headers.set(
    "Report-To",
    JSON.stringify({
      group: "csp-endpoint",
      max_age: 86400,
      endpoints: [{ url: cspReportUrl }],
    })
  );
  // Reporting-Endpoints is the modern successor to Report-To; send both.
  response.headers.set("Reporting-Endpoints", `csp-endpoint="${cspReportUrl}"`);

  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }
}

// -- Cookie helpers ----------------------------------------------------------

function clearPlaywrightSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: PLAYWRIGHT_SESSION_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

/**
 * Wrap a proxy result with CSP nonce + security headers.
 * Redirects and error responses get basic security headers only.
 */
export function withSecurityHeaders(
  request: NextRequest,
  proxyResponse: NextResponse
): NextResponse {
  const pathname = request.nextUrl.pathname;
  const shouldClearPlaywrightSession =
    !shouldUsePlaywrightStubForRequest(request) &&
    !!request.cookies.get(PLAYWRIGHT_SESSION_COOKIE)?.value;

  if (proxyResponse.headers.has("location") || proxyResponse.status >= 400) {
    if (shouldClearPlaywrightSession) {
      clearPlaywrightSessionCookie(proxyResponse);
    }

    proxyResponse.headers.set("X-Content-Type-Options", "nosniff");
    proxyResponse.headers.set("X-Frame-Options", "DENY");
    proxyResponse.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (shouldPreventApiCaching(pathname)) {
      applyNoStoreCacheControl(proxyResponse);
    }
    return proxyResponse;
  }

  const nonce = shouldUseStrictNonceCsp() ? generateNonce() : null;
  const isSecureRequest =
    request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const csp = buildCsp(nonce, {
    allowDevWebSocket: process.env.NODE_ENV !== "production",
    enforceHttps: isSecureRequest,
  });

  // Cacheable asset routes should not receive a CSRF bootstrap cookie from middleware.
  // A Set-Cookie on media/image responses forces browsers and CDNs to treat them as
  // private, overriding the immutable cache policy these routes are meant to serve.
  if (shouldSkipCsrfBootstrap(pathname)) {
    if (shouldClearPlaywrightSession) {
      clearPlaywrightSessionCookie(proxyResponse);
    }

    applySecurityHeaders(proxyResponse, csp);
    const assetCacheControl = getAssetCacheControl(pathname);
    if (assetCacheControl) {
      proxyResponse.headers.set("Cache-Control", assetCacheControl);
    } else if (shouldPreventApiCaching(pathname)) {
      applyNoStoreCacheControl(proxyResponse);
    }
    if (nonce) {
      proxyResponse.headers.set("x-nonce", nonce);
    }

    return proxyResponse;
  }

  // Inject x-nonce so Server Components can read it via `headers()`
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-current-pathname", pathname);
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

  // Transfer the CSRF cookie from the temporary response.
  const csrfCookie = csrfResponse.cookies.get("vm_csrf");
  if (csrfCookie) {
    response.cookies.set(csrfCookie);
  } else {
    const isSecure =
      request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
    response.cookies.set({
      name: "vm_csrf",
      value: csrfToken,
      httpOnly: false,
      sameSite: "lax",
      secure: isSecure,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }

  // Preserve cookies set during auth (Supabase session refresh, etc.)
  for (const cookie of proxyResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }

  if (shouldClearPlaywrightSession) {
    clearPlaywrightSessionCookie(response);
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
  if (
    shouldRelaxDocumentCache(request.nextUrl.pathname) &&
    !response.headers.has("Cache-Control") &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    applyNoStoreCacheControl(response);
  }
  if (shouldPreventApiCaching(request.nextUrl.pathname) && !response.headers.has("Cache-Control")) {
    applyNoStoreCacheControl(response);
  }
  if (nonce) {
    response.headers.set("x-nonce", nonce);
  }

  return response;
}

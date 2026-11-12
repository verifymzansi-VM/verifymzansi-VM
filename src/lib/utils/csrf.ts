import { NextResponse } from "next/server";
import type { Logger } from "@/lib/utils/logger";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  isValidCsrfToken as isValidToken,
  parseCsrfCookieHeader as parseCookieHeader,
} from "./csrf-client";

// Browser helpers live in ./csrf-client so client components never bundle
// `next/server`. Re-exported here for server code and older imports.
export {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  ensureCsrfTokenReady,
  getCsrfTokenFromDocumentCookie,
  withCsrfHeaders,
} from "./csrf-client";

const CSRF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;

interface HeaderLike {
  get(name: string): string | null;
}

interface CookieStoreLike {
  get(name: string): { value: string } | undefined;
}

interface CsrfRequestLike {
  headers: HeaderLike;
  cookies?: CookieStoreLike;
  url: string;
  nextUrl?: {
    pathname: string;
    protocol?: string;
  };
}

function getCookieToken(request: CsrfRequestLike): string | null {
  const fromStore = request.cookies?.get(CSRF_COOKIE_NAME)?.value;
  if (isValidToken(fromStore)) {
    return fromStore;
  }

  const fromHeader = parseCookieHeader(request.headers.get("cookie"), CSRF_COOKIE_NAME);
  return isValidToken(fromHeader) ? fromHeader : null;
}

function isSecureRequest(request: CsrfRequestLike): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto === "https") {
    return true;
  }

  if (request.nextUrl?.protocol) {
    return request.nextUrl.protocol === "https:";
  }

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function generateCsrfToken(): string {
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

function resolveCsrfToken(request: CsrfRequestLike): string {
  return getCookieToken(request) ?? generateCsrfToken();
}

export function ensureCsrfCookie(
  request: CsrfRequestLike,
  response: NextResponse,
  explicitToken?: string
): string {
  const token = explicitToken ?? resolveCsrfToken(request);

  response.cookies.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
  });

  // Expose the token via a response header so Server Components can inject
  // it into the page as a <meta> tag. Client JS should still prefer the
  // readable cookie because the server validates the double-submit pair
  // against the current cookie value.
  response.headers.set(CSRF_HEADER_NAME, token);

  return token;
}

export function enforceCsrfToken(
  request: CsrfRequestLike,
  log?: Pick<Logger, "warn">
): NextResponse | null {
  const cookieToken = getCookieToken(request);
  const headerToken = request.headers.get(CSRF_HEADER_NAME);

  if (isValidToken(cookieToken) && isValidToken(headerToken) && cookieToken === headerToken) {
    return null;
  }

  // Enhanced diagnostics: track token format validity separately from presence.
  // This distinguishes between missing tokens, malformed tokens, and mismatches.
  const cookieValid = isValidToken(cookieToken);
  const headerValid = isValidToken(headerToken);
  const tokensMatch = cookieToken === headerToken;

  const runtimeMode = (process.env.VERIFYMZANSI_RUNTIME_MODE || "").toLowerCase();
  const isE2eRuntime =
    runtimeMode === "e2e" ||
    runtimeMode === "playwright" ||
    runtimeMode === "test" ||
    process.env.PLAYWRIGHT_E2E_AUTH === "1";

  if (isE2eRuntime) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  log?.warn("Rejected request with invalid CSRF token", {
    path: request.nextUrl?.pathname ?? new URL(request.url).pathname,
    method: request.headers.get("x-forwarded-method") || "(unknown)",
    hasCookie: Boolean(cookieToken),
    hasHeader: Boolean(headerToken),
    cookieValid,
    headerValid,
    tokensMatch,
  });

  return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
}

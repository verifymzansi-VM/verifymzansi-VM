import { NextResponse, type NextRequest } from "next/server";
import type { Logger } from "@/lib/utils/logger";

export const CSRF_COOKIE_NAME = "vm_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const CSRF_TOKEN_RE = /^[a-f0-9]{64}$/i;
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

function isValidToken(token: string | null | undefined): token is string {
  return typeof token === "string" && CSRF_TOKEN_RE.test(token);
}

function parseCookieHeader(
  cookieHeader: string | null | undefined,
  cookieName: string
): string | null {
  if (!cookieHeader) return null;

  const prefix = `${cookieName}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }

  return null;
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

export function ensureCsrfCookie(request: NextRequest, response: NextResponse): string {
  const existingToken = getCookieToken(request);
  const token = existingToken ?? generateCsrfToken();

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
  // it into the page as a <meta> tag. Client JS prefers the meta tag but can
  // fall back to the readable cookie if the page shell is stale.
  response.headers.set(CSRF_HEADER_NAME, token);

  return token;
}

/**
 * Read the CSRF token from the server-injected <meta name="csrf-token"> tag.
 * Falls back to parsing a raw cookie string when called with an explicit source
 * (e.g. in unit tests).
 */
export function getCsrfTokenFromDocumentCookie(cookieSource?: string): string | null {
  if (cookieSource) {
    const token = parseCookieHeader(cookieSource, CSRF_COOKIE_NAME);
    return isValidToken(token) ? token : null;
  }

  if (typeof document === "undefined") return null;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
  const metaToken = meta?.content ?? null;
  if (isValidToken(metaToken)) {
    return metaToken;
  }

  const cookieToken = parseCookieHeader(document.cookie, CSRF_COOKIE_NAME);
  return isValidToken(cookieToken) ? cookieToken : null;
}

export function withCsrfHeaders(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  const token = getCsrfTokenFromDocumentCookie();

  if (token) {
    nextHeaders.set(CSRF_HEADER_NAME, token);
  }

  return nextHeaders;
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

  log?.warn("Rejected request with invalid CSRF token", {
    path: request.nextUrl?.pathname ?? new URL(request.url).pathname,
    hasCookie: Boolean(cookieToken),
    hasHeader: Boolean(headerToken),
  });

  return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
}

import { NextResponse } from "next/server";
import type { Logger } from "@/lib/utils/logger";

export const CSRF_COOKIE_NAME = "vm_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const CSRF_TOKEN_RE = /^[a-f0-9]{64}$/i;
const CSRF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;
let csrfBootstrapPromise: Promise<string | null> | null = null;

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

function ensureCsrfMetaTag(token: string): void {
  if (typeof document === "undefined") return;

  const head = document.head ?? document.querySelector("head");
  if (!head) return;

  let meta = head.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "csrf-token";
    head.appendChild(meta);
  }

  meta.content = token;
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
      try {
        return decodeURIComponent(trimmed.slice(prefix.length));
      } catch {
        // Malformed percent-encoding (e.g. "vm_csrf=%") — treat as no token.
        return null;
      }
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
  const cookieToken = parseCookieHeader(document.cookie, CSRF_COOKIE_NAME);
  if (isValidToken(cookieToken)) {
    // The cookie is the authoritative token for the server-side comparison.
    // If the layout's meta tag is stale after a client-side navigation or a
    // regenerated cookie, repair it so future reads stay in sync.
    ensureCsrfMetaTag(cookieToken);
    return cookieToken;
  }

  const metaToken = meta?.content ?? null;
  return isValidToken(metaToken) ? metaToken : null;
}

export async function ensureCsrfTokenReady(): Promise<string | null> {
  const existingToken = getCsrfTokenFromDocumentCookie();
  if (existingToken) {
    return existingToken;
  }

  if (typeof window === "undefined" || typeof fetch !== "function") {
    return null;
  }

  if (!csrfBootstrapPromise) {
    csrfBootstrapPromise = (async () => {
      try {
        const response = await fetch("/api/csrf", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          return null;
        }

        const payload = (await response.json().catch(() => null)) as { token?: unknown } | null;
        const responseToken = typeof payload?.token === "string" ? payload.token : null;
        const currentToken = getCsrfTokenFromDocumentCookie();
        const token = currentToken ?? (isValidToken(responseToken) ? responseToken : null);

        if (token) {
          ensureCsrfMetaTag(token);
        }

        return token;
      } catch {
        return null;
      } finally {
        csrfBootstrapPromise = null;
      }
    })();
  }

  return csrfBootstrapPromise;
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
    url: request.url,
    hasCookie: Boolean(cookieToken),
    hasHeader: Boolean(headerToken),
    cookieValid,
    headerValid,
    tokensMatch,
  });

  return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
}

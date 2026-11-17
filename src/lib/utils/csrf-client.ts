// Browser half of the CSRF helpers: reading the token and adding the header.
// It must not import `next/server`: that module is CommonJS, so any client
// component importing it (even through `./csrf`) ships Next's server request
// code to phones. Client components import from here; `./csrf` re-exports
// everything for server code and older imports.

export const CSRF_COOKIE_NAME = "vm_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const CSRF_TOKEN_RE = /^[a-f0-9]{64}$/i;
let csrfBootstrapPromise: Promise<string | null> | null = null;

export function isValidCsrfToken(token: string | null | undefined): token is string {
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

export function parseCsrfCookieHeader(
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

/**
 * Read the CSRF token from the server-injected <meta name="csrf-token"> tag.
 * Falls back to parsing a raw cookie string when called with an explicit source
 * (e.g. in unit tests).
 */
export function getCsrfTokenFromDocumentCookie(cookieSource?: string): string | null {
  if (cookieSource) {
    const token = parseCsrfCookieHeader(cookieSource, CSRF_COOKIE_NAME);
    return isValidCsrfToken(token) ? token : null;
  }

  if (typeof document === "undefined") return null;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
  const cookieToken = parseCsrfCookieHeader(document.cookie, CSRF_COOKIE_NAME);
  if (isValidCsrfToken(cookieToken)) {
    // The cookie is the authoritative token for the server-side comparison.
    // If the layout's meta tag is stale after a client-side navigation or a
    // regenerated cookie, repair it so future reads stay in sync.
    ensureCsrfMetaTag(cookieToken);
    return cookieToken;
  }

  const metaToken = meta?.content ?? null;
  return isValidCsrfToken(metaToken) ? metaToken : null;
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
        const token = currentToken ?? (isValidCsrfToken(responseToken) ? responseToken : null);

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

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  enforceCsrfToken,
  ensureCsrfCookie,
  getCsrfTokenFromDocumentCookie,
  withCsrfHeaders,
} from "./csrf";

describe("csrf utilities", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.cookie = `${CSRF_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

  it("prefers the meta tag token when reading from the document", () => {
    document.head.innerHTML = `<meta name="csrf-token" content="${"a".repeat(64)}" />`;
    document.cookie = `${CSRF_COOKIE_NAME}=${"b".repeat(64)}`;

    expect(getCsrfTokenFromDocumentCookie()).toBe("a".repeat(64));
  });

  it("falls back to document.cookie when the meta tag is missing", () => {
    document.cookie = `${CSRF_COOKIE_NAME}=${"a".repeat(64)}`;

    expect(getCsrfTokenFromDocumentCookie()).toBe("a".repeat(64));
  });

  it("extracts a valid CSRF token from a raw cookie string (test mode)", () => {
    const token = "a".repeat(64);
    expect(getCsrfTokenFromDocumentCookie(`foo=bar; ${CSRF_COOKIE_NAME}=${token}`)).toBe(token);
  });

  it("rejects requests with mismatched CSRF header and cookie", () => {
    const request = {
      url: "https://verifymzansi.com/api/test",
      headers: new Headers({
        cookie: `${CSRF_COOKIE_NAME}=${"a".repeat(64)}`,
        [CSRF_HEADER_NAME]: "b".repeat(64),
      }),
    };

    const response = enforceCsrfToken(request);

    expect(response?.status).toBe(403);
  });

  it("sets a readable CSRF cookie when the request does not already have one", () => {
    const request = new NextRequest("https://verifymzansi.com/");
    const response = NextResponse.next();

    ensureCsrfCookie(request, response);

    const cookie = response.cookies.get(CSRF_COOKIE_NAME);
    expect(cookie?.value).toMatch(/^[a-f0-9]{64}$/i);
    expect(cookie?.httpOnly).toBe(false);
  });

  it("sets the CSRF token as a response header for server-component injection", () => {
    const request = new NextRequest("https://verifymzansi.com/");
    const response = NextResponse.next();

    const token = ensureCsrfCookie(request, response);

    expect(response.headers.get(CSRF_HEADER_NAME)).toBe(token);
  });

  it("adds the CSRF header from the cookie fallback", () => {
    document.head.innerHTML = "";
    document.cookie = `${CSRF_COOKIE_NAME}=${"a".repeat(64)}`;

    const headers = withCsrfHeaders({ "Content-Type": "application/json" });

    expect(headers.get(CSRF_HEADER_NAME)).toBe("a".repeat(64));
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});

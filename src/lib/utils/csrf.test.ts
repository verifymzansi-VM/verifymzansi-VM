import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  enforceCsrfToken,
  ensureCsrfCookie,
  getCsrfTokenFromDocumentCookie,
} from "./csrf";

describe("csrf utilities", () => {
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

  it("sets an httpOnly CSRF cookie when the request does not already have one", () => {
    const request = new NextRequest("https://verifymzansi.com/");
    const response = NextResponse.next();

    ensureCsrfCookie(request, response);

    const cookie = response.cookies.get(CSRF_COOKIE_NAME);
    expect(cookie?.value).toMatch(/^[a-f0-9]{64}$/i);
  });

  it("sets the CSRF token as a response header for server-component injection", () => {
    const request = new NextRequest("https://verifymzansi.com/");
    const response = NextResponse.next();

    const token = ensureCsrfCookie(request, response);

    expect(response.headers.get(CSRF_HEADER_NAME)).toBe(token);
  });
});

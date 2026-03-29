/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  ensureCsrfTokenReady,
  enforceCsrfToken,
  ensureCsrfCookie,
  getCsrfTokenFromDocumentCookie,
  withCsrfHeaders,
} from "./csrf";

describe("csrf utilities", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.cookie = `${CSRF_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers the readable cookie token when the meta tag is stale", () => {
    document.head.innerHTML = `<meta name="csrf-token" content="${"a".repeat(64)}" />`;
    document.cookie = `${CSRF_COOKIE_NAME}=${"b".repeat(64)}`;

    expect(getCsrfTokenFromDocumentCookie()).toBe("b".repeat(64));
    expect(document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content).toBe(
      "b".repeat(64)
    );
  });

  it("falls back to the meta tag token when the readable cookie is missing", () => {
    document.head.innerHTML = `<meta name="csrf-token" content="${"a".repeat(64)}" />`;

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

  it("adds the CSRF header from the current cookie when the meta tag is stale", () => {
    document.head.innerHTML = `<meta name="csrf-token" content="${"a".repeat(64)}" />`;
    document.cookie = `${CSRF_COOKIE_NAME}=${"b".repeat(64)}`;

    const headers = withCsrfHeaders({ "Content-Type": "application/json" });

    expect(headers.get(CSRF_HEADER_NAME)).toBe("b".repeat(64));
  });

  it("returns the existing CSRF token without calling the bootstrap route", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=${"a".repeat(64)}`;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(ensureCsrfTokenReady()).resolves.toBe("a".repeat(64));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches a CSRF token once and repairs the meta tag", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "c".repeat(64) }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const [firstToken, secondToken] = await Promise.all([
      ensureCsrfTokenReady(),
      ensureCsrfTokenReady(),
    ]);

    expect(firstToken).toBe("c".repeat(64));
    expect(secondToken).toBe("c".repeat(64));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content).toBe(
      "c".repeat(64)
    );
  });

  it("returns null when the bootstrap route fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "unavailable" }),
      })
    );

    await expect(ensureCsrfTokenReady()).resolves.toBeNull();
    expect(document.querySelector('meta[name="csrf-token"]')).toBeNull();
  });

  it("repairs the meta tag from the fetched token before adding CSRF headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: "d".repeat(64) }),
      })
    );

    await ensureCsrfTokenReady();
    const headers = withCsrfHeaders({ "Content-Type": "application/json" });

    expect(headers.get(CSRF_HEADER_NAME)).toBe("d".repeat(64));
  });
});

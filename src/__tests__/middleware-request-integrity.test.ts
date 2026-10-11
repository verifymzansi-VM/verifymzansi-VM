/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { withSecurityHeaders } from "@/lib/middleware/security-headers";
import { enforceCsrfToken, CSRF_HEADER_NAME } from "@/lib/utils/csrf";

// Apply the request overrides exactly as Next's routing layer does.
function downstreamRequest(request: NextRequest, response: NextResponse): Request {
  const headers = new Headers(request.headers);
  const overrides = response.headers.get("x-middleware-override-headers");
  if (overrides !== null) {
    const keys = overrides.split(",");
    for (const key of [...headers.keys()]) if (!keys.includes(key)) headers.delete(key);
    for (const key of keys) {
      const value = response.headers.get(`x-middleware-request-${key}`);
      if (value === null) headers.delete(key);
      else headers.set(key, value);
    }
  }
  return new Request(request.url, { method: request.method, headers });
}

afterEach(() => vi.unstubAllEnvs());

describe("middleware request integrity", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s cannot manufacture missing or mismatched client CSRF proof",
    (method) => {
      for (const token of [null, "b".repeat(64), "a".repeat(64)]) {
        const headers = new Headers({ cookie: `vm_csrf=${"a".repeat(64)}` });
        if (token) headers.set(CSRF_HEADER_NAME, token);
        const request = new NextRequest("https://verifymzansi.com/api/auth/change-password", {
          method,
          headers,
        });
        const response = withSecurityHeaders(request, NextResponse.next());
        const forwarded = downstreamRequest(request, response);
        expect(forwarded.headers.get(CSRF_HEADER_NAME)).toBe(token);
        expect(enforceCsrfToken(forwarded)?.status ?? 200).toBe(
          token === "a".repeat(64) ? 200 : 403
        );
        expect(response.cookies.get("vm_csrf")).toBeUndefined();
      }
    }
  );

  it("forwards the final pathname and nonce despite earlier auth overrides", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest("https://verifymzansi.com/login", {
      headers: { "x-current-pathname": "/forged", "x-nonce": "forged" },
    });
    const authResponse = NextResponse.next({ request: { headers: request.headers } });
    authResponse.cookies.set("sb-session", "refreshed", { httpOnly: true });
    const response = withSecurityHeaders(request, authResponse);
    const forwarded = downstreamRequest(request, response);
    expect(forwarded.headers.get("x-current-pathname")).toBe("/login");
    expect(forwarded.headers.get("x-nonce")).toBe(response.headers.get("x-nonce"));
    expect(forwarded.headers.get("Content-Security-Policy")).toBe(
      response.headers.get("Content-Security-Policy")
    );
    expect(response.cookies.get("sb-session")?.value).toBe("refreshed");
    expect(response.headers.get("x-middleware-set-cookie")).toContain("vm_csrf=");
    expect(response.headers.get("x-middleware-set-cookie")).toContain("sb-session=");
  });

  it("lets public previews select success caching without issuing cookies", () => {
    const request = new NextRequest("https://verifymzansi.com/api/share-preview/listing/id");
    const response = withSecurityHeaders(request, NextResponse.next());
    expect(response.headers.get("Cache-Control")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const error = withSecurityHeaders(
      request,
      NextResponse.json({ error: "busy" }, { status: 429 })
    );
    expect(error.headers.get("Cache-Control")).toContain("no-store");
  });
});

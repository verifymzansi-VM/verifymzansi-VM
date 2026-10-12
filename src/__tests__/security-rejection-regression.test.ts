import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { withSecurityHeaders } from "@/lib/middleware/security-headers";

describe("production rejected-response security contract", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([401, 403, 429, 503])(
    "preserves a %i response with transport/browser policy",
    async (status) => {
      vi.stubEnv("NODE_ENV", "production");
      const request = new NextRequest("https://verifymzansi.example/api/verification/status");
      const original = NextResponse.json({ error: "synthetic rejection" }, { status });
      original.headers.set("Retry-After", "30");
      original.cookies.set("synthetic-refresh", "safe-value", { httpOnly: true });
      const result = withSecurityHeaders(request, original);
      expect(result).toBe(original);
      expect(result.status).toBe(status);
      expect(result.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
      expect(result.headers.get("Content-Security-Policy")).toContain("object-src 'none'");
      expect(result.headers.get("Retry-After")).toBe("30");
      expect(result.cookies.get("synthetic-refresh")?.value).toBe("safe-value");
      expect(result.cookies.get("vm_csrf")).toBeUndefined();
      expect(await result.json()).toEqual({ error: "synthetic rejection" });
    }
  );
  it("preserves a login redirect and its cookie without bootstrapping CSRF", () => {
    vi.stubEnv("NODE_ENV", "production");
    const location = "https://verifymzansi.example/login?returnUrl=%2Fdashboard";
    const original = NextResponse.redirect(location);
    original.cookies.set("synthetic-refresh", "safe-value");
    const result = withSecurityHeaders(
      new NextRequest("https://verifymzansi.example/dashboard"),
      original
    );
    expect(result.status).toBe(307);
    expect(result.headers.get("location")).toBe(location);
    expect(result.headers.get("Strict-Transport-Security")).toContain("includeSubDomains");
    expect(result.headers.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(result.cookies.get("synthetic-refresh")?.value).toBe("safe-value");
    expect(result.cookies.get("vm_csrf")).toBeUndefined();
  });
});

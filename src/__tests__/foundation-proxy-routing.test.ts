import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { routeRequest } from "@/proxy-handler";
import { checkFoundationPageAccess } from "@/lib/foundation/page-access";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/page-access", () => ({ checkFoundationPageAccess: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://gntzjtuncsyefujajmjy.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_proxy_synthetic");
  vi.mocked(checkFoundationPageAccess).mockResolvedValue(
    new NextResponse("native", { status: 202 })
  );
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  ["/login", true],
  ["/register", true],
  ["/dashboard/complete-profile", false],
  ["/staff/two-step", false],
  ["/admin", false],
  ["/api/account", false],
])("routes %s exclusively through the native account check", async (path, authPage) => {
  const request = new NextRequest("https://verifymzansi.com" + path);
  const response = await routeRequest(request);
  expect(response.status).toBe(202);
  expect(checkFoundationPageAccess).toHaveBeenCalledWith(request, authPage);
});
it.each(["/", "/adminevil", "/api/account-extra", "/terms"])(
  "keeps %s public without an account request",
  async (path) => {
    const response = await routeRequest(new NextRequest("https://verifymzansi.com" + path));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(checkFoundationPageAccess).not.toHaveBeenCalled();
  }
);
it("sends /banned through the account check", async () => {
  const request = new NextRequest("https://verifymzansi.com/banned");
  expect((await routeRequest(request)).status).toBe(202);
  expect(checkFoundationPageAccess).toHaveBeenCalledWith(request, false);
});

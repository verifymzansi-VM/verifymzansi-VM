/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationAccountContext } from "@/lib/foundation/account-context";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/account-context", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationAccountContext: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
vi.mock("@/lib/security/security-events", () => ({
  recordSecurityEvent: vi.fn(),
  securityContext: () => ({}),
}));
const rpc = vi.fn();
const authenticate = vi.fn();
const csrf = "c".repeat(64);
const profile = {
  display_name: "Thando",
  public_name: "Thando",
  bio: null,
  avatar_object_id: null,
  legal_first_name: null,
  legal_last_name: null,
  legal_name_locked: false,
  identity_verified: false,
  revision: 2,
  updated_at: "2026-11-03T12:00:00Z",
};
const account = {
  account_id: "11111111-1111-4111-8111-111111111111",
  phone: "+27820000000",
  profile,
};
const body = {
  displayName: "Thando Dlamini",
  bio: "New bio",
  phone: "0820000000",
  province: "Gauteng",
  city: "Johannesburg",
  expectedRevision: 1,
};
function request(value: unknown, validCsrf = true) {
  return new NextRequest("https://verifymzansi.com/api/profile/update", {
    method: "POST",
    body: JSON.stringify(value),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(validCsrf ? { "x-csrf-token": csrf } : {}),
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  authenticate.mockResolvedValue({ rpc });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate,
    respond: async (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(readFoundationAccountContext).mockResolvedValue(
    account as unknown as Awaited<ReturnType<typeof readFoundationAccountContext>>
  );
  rpc.mockResolvedValue({ data: profile, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("adapts the preserved form to one revision-fenced native command", async () => {
  const response = await POST(request(body));
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith(
    "save_my_frontend_profile",
    {
      p_expected_revision: 1,
      p_display_name: "Thando Dlamini",
      p_bio: "New bio",
      p_province: "gp",
      p_city: "gp_johannesburg",
    },
    { get: false }
  );
  expect(await response.json()).toMatchObject({
    success: true,
    profile: { phone: account.phone, revision: 2 },
  });
  expect(createAdminClient).not.toHaveBeenCalled();
});
it("reports a stale profile without mislabelling it as a phone-number conflict", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "PT409", details: "profile_changed" } });
  const response = await POST(request(body));
  expect(response.status).toBe(412);
  expect((await response.json()).error).toMatch(/Reload/);
});
it("never changes a canonical phone from the profile form", async () => {
  const response = await POST(request({ ...body, phone: "0830000000" }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "PHONE_REVERIFICATION_REQUIRED" });
  expect(rpc).not.toHaveBeenCalled();
});
it("preserves CSRF and blocks claimed authority or missing revision fields", async () => {
  expect((await POST(request(body, false))).status).toBe(403);
  expect((await POST(request({ ...body, role: "admin" }))).status).toBe(400);
  expect((await POST(request({ ...body, expectedRevision: undefined }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it("allows a bio save without resending a locked legal display name", async () => {
  vi.mocked(readFoundationAccountContext).mockResolvedValue({
    ...account,
    profile: { ...profile, legal_name_locked: true, public_name: "A".repeat(100) },
  } as unknown as Awaited<ReturnType<typeof readFoundationAccountContext>>);
  expect((await POST(request({ ...body, displayName: undefined }))).status).toBe(200);
  expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_display_name");
});

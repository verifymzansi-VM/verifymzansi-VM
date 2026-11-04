/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
vi.mock("@/lib/utils/admin-route-guard", () => ({
  enforceAdminMutationGuard: vi.fn(() => {
    throw new Error("Retired staff guard used");
  }),
}));
const actor = "11111111-1111-4111-8111-111111111111",
  csrf = "c".repeat(64),
  rpc = vi.fn();
const flag = {
  id: actor,
  key: "kyc_evidence_desk",
  enabled: true,
  mode: "on",
  rollout_percent: 100,
  allowlist_roles: [],
  revision: 2,
  description: "Optional evidence desk",
  updated_at: "2026-11-04T22:00:00Z",
  updated_reason: "Quick toggle: on",
};
function request(body: unknown, valid = true) {
  return new NextRequest("https://verifymzansi.com/api/admin/feature-flags/toggle", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(valid ? { "x-csrf-token": csrf } : {}),
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  rpc.mockResolvedValue({ data: { account_id: actor, flags: [flag] }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("routes the existing quick toggle to one revision-fenced, audited native command", async () => {
  const response = await POST(request({ key: flag.key, enabled: true, expectedRevision: 1 }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, flag });
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "set_frontend_feature_flag",
    {
      p_key: flag.key,
      p_expected_revision: 1,
      p_mode: "on",
      p_percent: 100,
      p_roles: [],
      p_reason: "Quick toggle: on",
    },
    { get: false }
  );
  expect(enforceAdminMutationGuard).not.toHaveBeenCalled();
});
it("refuses unrepresented/authority-bearing writes and CSRF before native mutation", async () => {
  for (const body of [
    { key: flag.key, enabled: true },
    { key: flag.key, enabled: true, expectedRevision: 1, actorId: actor },
  ])
    expect((await POST(request(body))).status).toBe(422);
  expect(
    (await POST(request({ key: flag.key, enabled: true, expectedRevision: 1 }, false))).status
  ).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it("preserves native stale-revision/MFA refusals without retrying or updating through the old backend", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
  expect((await POST(request({ key: flag.key, enabled: true, expectedRevision: 1 }))).status).toBe(
    409
  );
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", message: "recent authenticator app proof required" },
  });
  const response = await POST(request({ key: flag.key, enabled: true, expectedRevision: 1 }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "step_up_required" });
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(enforceAdminMutationGuard).not.toHaveBeenCalled();
});

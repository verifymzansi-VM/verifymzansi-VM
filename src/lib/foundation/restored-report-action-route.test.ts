/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { handleRestoredReportAction } from "./restored-report-action-route";
import { createFoundationRouteContext } from "./request-route";
import { checkRateLimit } from "../utils/rate-limit";
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
const reportId = "11111111-1111-4111-8111-111111111111",
  nonce = "22222222-2222-4222-8222-222222222222",
  csrf = "c".repeat(64),
  rpc = vi.fn();
const body = () => ({
  reportId,
  action: "dismiss",
  reason: "Reviewed and dismissed the report",
  foundation: { expectedRevision: 2, claimGeneration: "3", claimNonce: nonce },
});
function request(value: unknown = body(), valid = true) {
  return new NextRequest("https://verifymzansi.com/api/admin/flagging/action", {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(valid ? { "x-csrf-token": csrf } : {}),
    },
    body: JSON.stringify(value),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  rpc.mockResolvedValue({
    data: { report_id: reportId, action: "dismiss", status: "dismissed" },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("binds dismissal to the represented native report revision and claim without caller-selected authority", async () => {
  const response = await handleRestoredReportAction(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    success: true,
    action: "dismiss",
    status: "dismissed",
    message: "Report dismissed.",
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "execute_frontend_report_action_v2",
    {
      p_report: reportId,
      p_expected_revision: 2,
      p_claim_generation: "3",
      p_claim_nonce: nonce,
      p_action: "dismiss",
      p_reason: body().reason,
      p_emergency: false,
    },
    { get: false }
  );
});
it("refuses missing scope, supplied authority, short reasons and invalid CSRF before mutation", async () => {
  for (const value of [
    { ...body(), foundation: undefined },
    { ...body(), actorId: nonce },
    { ...body(), reason: "no" },
  ])
    expect((await handleRestoredReportAction(request(value))).status).toBe(422);
  expect((await handleRestoredReportAction(request(body(), false))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it("keeps stale/MFA refusals and contradictory acknowledgements visible without replay", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
  expect((await handleRestoredReportAction(request())).status).toBe(409);
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", message: "recent authenticator app proof required" },
  });
  const response = await handleRestoredReportAction(request());
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "step_up_required" });
  rpc.mockResolvedValueOnce({
    data: { report_id: reportId, action: "dismiss", status: "applied" },
    error: null,
  });
  expect((await handleRestoredReportAction(request())).status).toBe(503);
  expect(rpc).toHaveBeenCalledTimes(3);
});
it("requires and forwards the represented content revision before hiding", async () => {
  expect((await handleRestoredReportAction(request({ ...body(), action: "hide" }))).status).toBe(
    422
  );
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValueOnce({
    data: { report_id: reportId, action: "hide", status: "applied" },
    error: null,
  });
  const response = await handleRestoredReportAction(
    request({
      ...body(),
      action: "hide",
      foundation: { ...body().foundation, expectedPostRevision: 9 },
    })
  );
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "execute_frontend_report_action_v2",
    expect.objectContaining({
      p_action: "hide",
      p_expected_post_revision: 9,
      p_expected_revision: 2,
      p_claim_nonce: nonce,
    }),
    { get: false }
  );
});

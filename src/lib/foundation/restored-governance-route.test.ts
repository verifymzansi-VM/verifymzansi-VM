/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { handleRestoredGovernanceDecision } from "./restored-governance-route";
import { createFoundationRouteContext } from "./request-route";
import { checkRateLimit } from "../utils/rate-limit";
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const foundation = { caseId: id(1), caseVersion: 7, proposalVersion: 7 };
const input = () => ({
  decisionId: id(2),
  action: "approve",
  payloadVersion: 7,
  rationale: "Inspected the current evidence independently",
  foundation,
});
const csrf = "c".repeat(64),
  rpc = vi.fn();
function request(body: unknown, validCsrf = true) {
  return new NextRequest("https://verifymzansi.com/api/admin/governance/decide", {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(validCsrf ? { "x-csrf-token": csrf } : {}),
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  rpc.mockResolvedValue({ data: { decision_id: id(2), status: "approved" }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("binds the existing approval to both represented versions without caller-selected authority", async () => {
  const response = await handleRestoredGovernanceDecision(request(input()));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "approved", decisionId: id(2) });
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "decide_frontend_governance",
    {
      p_decision: id(2),
      p_case: id(1),
      p_expected_version: 7,
      p_proposal_version: 7,
      p_action: "approve",
      p_reason: input().rationale,
    },
    { get: false }
  );
});
it("refuses missing/mismatched scope, supplied authority, retired retry actions and missing CSRF", async () => {
  for (const body of [
    { ...input(), foundation: undefined },
    { ...input(), payloadVersion: 8 },
    { ...input(), actorId: id(3) },
    { ...input(), action: "retry_execution" },
  ])
    expect((await handleRestoredGovernanceDecision(request(body))).status).toBe(422);
  expect((await handleRestoredGovernanceDecision(request(input(), false))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it("keeps native MFA/version refusals visible and sends no automatic mutation retry", async () => {
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", message: "recent authenticator app proof required" },
  });
  const response = await handleRestoredGovernanceDecision(request(input()));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "step_up_required" });
  rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
  expect((await handleRestoredGovernanceDecision(request(input()))).status).toBe(409);
  expect(rpc).toHaveBeenCalledTimes(2);
});
it("accepts native withdrawal for the existing proposer control and rejects contradictory acknowledgements", async () => {
  rpc.mockResolvedValueOnce({ data: { decision_id: id(2), status: "withdrawn" }, error: null });
  const response = await handleRestoredGovernanceDecision(
    request({ ...input(), action: "reject" })
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "withdrawn" });
  rpc.mockResolvedValueOnce({ data: { decision_id: id(2), status: "rejected" }, error: null });
  expect((await handleRestoredGovernanceDecision(request(input()))).status).toBe(503);
});

/** @vitest-environment node */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { handleRestoredIdentityDecision } from "./restored-identity-decision-route";
import { createFoundationRouteContext } from "./request-route";
import { checkRateLimit } from "../utils/rate-limit";
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const scope = {
  caseId: id(1),
  caseVersion: 7,
  submissionId: id(2),
  claimGeneration: "4",
  claimNonce: id(3),
};
const input = () => ({
  stepId: id(4),
  expectedUpdatedAt: "2026-11-04T10:00:00Z",
  decision: "approved",
  stepMatches: true,
  foundation: scope,
});
const csrf = "c".repeat(64),
  rpc = vi.fn();
function request(body: unknown, valid = true) {
  return new NextRequest("https://verifymzansi.com/api/admin/verification/decide", {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(valid ? { "x-csrf-token": csrf } : {}),
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
    respond: (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  rpc.mockResolvedValue({
    data: {
      case_id: scope.caseId,
      submission_id: scope.submissionId,
      artifact_id: id(4),
      purpose: "id_front",
      status: "step_approved",
    },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("records the explicitly confirmed step using the represented submission and lease", async () => {
  const response = await handleRestoredIdentityDecision(request(input()));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, status: "step_approved" });
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "approve_frontend_identity_step",
    {
      p_case: scope.caseId,
      p_submission: scope.submissionId,
      p_artifact: id(4),
      p_expected_version: 7,
      p_claim_generation: "4",
      p_claim_nonce: scope.claimNonce,
      p_matches: true,
    },
    { get: false }
  );
});
it("reports a high-risk proposal without claiming an accepted identity", async () => {
  rpc.mockResolvedValue({
    data: {
      case_id: scope.caseId,
      submission_id: scope.submissionId,
      artifact_id: id(4),
      purpose: "id_front",
      status: "awaiting_second_reviewer",
      decision_id: id(8),
    },
    error: null,
  });
  const response = await handleRestoredIdentityDecision(
    request({ ...input(), overrideReasonCode: "supporting_evidence" })
  );
  expect(await response.json()).toEqual({
    success: true,
    status: "awaiting_second_reviewer",
    overrideProposed: true,
    decisionId: id(8),
  });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("binds a rejection to the reviewed pair and retains the written explanation", async () => {
  rpc.mockResolvedValue({
    data: {
      case_id: scope.caseId,
      submission_id: scope.submissionId,
      artifact_id: id(4),
      status: "needs_resubmission",
      decision: "rejected",
      version: 8,
    },
    error: null,
  });
  const response = await handleRestoredIdentityDecision(
    request({
      ...input(),
      decision: "rejected",
      stepMatches: undefined,
      reasonCode: "blurry_image",
      reasonNote: "Please retake the complete document.",
    })
  );
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "return_frontend_identity_step",
    expect.objectContaining({
      p_case: scope.caseId,
      p_submission: scope.submissionId,
      p_artifact: id(4),
      p_expected_version: 7,
      p_decision: "rejected",
      p_reason: expect.stringContaining("Please retake the complete document."),
    }),
    { get: false }
  );
});
it("requires a genuine confirmation, full fence, meaningful reason and CSRF before a command", async () => {
  for (const body of [
    { ...input(), stepMatches: false },
    { ...input(), foundation: undefined },
    { ...input(), decision: "rejected", reasonCode: "blurry_image", reasonNote: "" },
    { ...input(), role: "admin" },
  ])
    expect((await handleRestoredIdentityDecision(request(body))).status).toBe(422);
  expect((await handleRestoredIdentityDecision(request(input(), false))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it("preserves native refusals and never replays a lost decision reply", async () => {
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", message: "recent second-factor verification required" },
  });
  const denied = await handleRestoredIdentityDecision(request(input()));
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ code: "step_up_required" });
  rpc.mockClear();
  rpc.mockRejectedValueOnce(new Error("lost reply"));
  expect((await handleRestoredIdentityDecision(request(input()))).status).toBe(503);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("refuses an acknowledgement for another submission", async () => {
  rpc.mockResolvedValue({
    data: {
      case_id: scope.caseId,
      submission_id: id(99),
      artifact_id: id(4),
      purpose: "id_front",
      status: "accepted",
      identity_fact_id: id(8),
    },
    error: null,
  });
  expect((await handleRestoredIdentityDecision(request(input()))).status).toBe(503);
  expect(rpc).toHaveBeenCalledTimes(1);
});

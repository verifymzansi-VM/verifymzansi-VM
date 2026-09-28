import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as DecisionLedger from "@/lib/services/decision-ledger";

const {
  guard,
  approveDecision,
  rejectDecision,
  escalateDecision,
  markDecisionExecution,
  applyVerificationDecision,
  adminFrom,
  reportCriticalIncident,
} = vi.hoisted(() => ({
  guard: vi.fn(),
  approveDecision: vi.fn(),
  rejectDecision: vi.fn(),
  escalateDecision: vi.fn(),
  markDecisionExecution: vi.fn(),
  applyVerificationDecision: vi.fn(),
  adminFrom: vi.fn(),
  reportCriticalIncident: vi.fn(),
}));

vi.mock("@/lib/utils/admin-route-guard", () => ({ enforceAdminMutationGuard: guard }));
vi.mock("@/lib/services/decision-ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof DecisionLedger>()),
  approveDecision,
  rejectDecision,
  escalateDecision,
  markDecisionExecution,
}));
vi.mock("@/lib/services/verification-decision", () => ({ applyVerificationDecision }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: adminFrom }) }));
vi.mock("@/lib/utils/alerts", () => ({ reportCriticalIncident }));

import { POST } from "@/app/api/admin/governance/decide/route";

const GOV = "11111111-1111-4111-8111-111111111111";
const DECISION = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const STEP = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

const request = (body: Record<string, unknown>) =>
  new Request("http://localhost:3000/api/admin/governance/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function tableReturns(data: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue({ data });
  adminFrom.mockReturnValue({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) });
}

describe("POST /api/admin/governance/decide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.mockResolvedValue({
      success: true,
      user: { id: GOV },
      actorRole: "governance_controller",
    });
  });

  it("requires decision:approve", async () => {
    guard.mockResolvedValue({ success: false, response: new Response(null, { status: 403 }) });
    const res = await POST(
      request({ action: "approve", decisionId: DECISION, payloadVersion: 1, rationale: "ok" })
    );
    expect(res.status).toBe(403);
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ capability: "decision:approve" }));
  });

  it("approves the exact payload version with the verified approver", async () => {
    approveDecision.mockResolvedValue({ ok: true, status: "applied", decision_id: DECISION });
    const res = await POST(
      request({
        action: "approve",
        decisionId: DECISION,
        payloadVersion: 2,
        rationale: "Evidence is clear",
      })
    );
    expect(res.status).toBe(200);
    expect(approveDecision).toHaveBeenCalledWith(GOV, DECISION, 2, "Evidence is clear");
    expect(applyVerificationDecision).not.toHaveBeenCalled();
  });

  it("no longer accepts a typed secondary approver", async () => {
    const res = await POST(
      request({
        action: "approve",
        decisionId: DECISION,
        rationale: "ok",
        secondaryApproverId: GOV,
      })
    );
    expect(res.status).toBe(400);
    expect(approveDecision).not.toHaveBeenCalled();
  });

  it.each([
    ["not_independent", 403],
    ["payload_changed", 409],
    ["expired", 410],
    ["not_pending", 409],
  ])("maps the %s refusal to %i", async (error, status) => {
    approveDecision.mockResolvedValue({ ok: false, error });
    const res = await POST(
      request({ action: "approve", decisionId: DECISION, payloadVersion: 1, rationale: "ok" })
    );
    expect(res.status).toBe(status);
  });

  it("runs an approved KYC override and records success", async () => {
    approveDecision.mockResolvedValue({
      ok: true,
      status: "approved",
      decision_id: DECISION,
      execution: "pending",
      payload: { step_id: STEP, user_id: "member-1", override_reason_code: "verified_in_person" },
    });
    tableReturns({ id: STEP, user_id: "member-1", step_type: "id_doc", status: "pending" });
    applyVerificationDecision.mockResolvedValue({ ok: true });

    const res = await POST(
      request({ action: "approve", decisionId: DECISION, payloadVersion: 1, rationale: "ok" })
    );

    expect(res.status).toBe(200);
    expect(applyVerificationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "approved",
        overrideReasonCode: "verified_in_person",
        reviewerId: GOV,
        allowAlreadyApplied: false,
      })
    );
    expect(markDecisionExecution).toHaveBeenCalledWith(DECISION, true);
  });

  it("keeps a failed KYC override visible, alerts, and returns 502", async () => {
    approveDecision.mockResolvedValue({
      ok: true,
      status: "approved",
      decision_id: DECISION,
      execution: "pending",
      payload: { step_id: STEP, user_id: "member-1" },
    });
    tableReturns({ id: STEP, user_id: "member-1", step_type: "id_doc", status: "pending" });
    applyVerificationDecision.mockResolvedValue({
      ok: false,
      status: 500,
      error: "profile update failed",
    });

    const res = await POST(
      request({ action: "approve", decisionId: DECISION, payloadVersion: 1, rationale: "ok" })
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ code: "execution_failed" });
    expect(markDecisionExecution).toHaveBeenCalledWith(DECISION, false, "profile update failed");
    expect(reportCriticalIncident).toHaveBeenCalled();
  });

  it("lets only admins retry a failed execution, idempotently", async () => {
    const res = await POST(request({ action: "retry_execution", decisionId: DECISION }));
    expect(res.status).toBe(403);

    guard.mockResolvedValue({ success: true, user: { id: GOV }, actorRole: "admin" });
    tableReturns({
      id: DECISION,
      status: "approved",
      action_category: "kyc_override",
      execution_status: "failed",
      payload: { step_id: STEP },
    });
    const step = { id: STEP, user_id: "member-1", step_type: "id_doc", status: "approved" };
    adminFrom
      .mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: DECISION,
                status: "approved",
                action_category: "kyc_override",
                execution_status: "failed",
                payload: { step_id: STEP },
              },
            }),
          })),
        })),
      })
      .mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: step }) })),
        })),
      });
    applyVerificationDecision.mockResolvedValue({ ok: true });

    const retry = await POST(request({ action: "retry_execution", decisionId: DECISION }));

    expect(retry.status).toBe(200);
    expect(applyVerificationDecision).toHaveBeenCalledWith(
      expect.objectContaining({ allowAlreadyApplied: true })
    );
    expect(markDecisionExecution).toHaveBeenCalledWith(DECISION, true);
  });

  it("rejects through the database", async () => {
    rejectDecision.mockResolvedValue({ ok: true, status: "rejected" });
    const res = await POST(
      request({ action: "reject", decisionId: DECISION, rationale: "Not enough evidence" })
    );
    expect(res.status).toBe(200);
    expect(rejectDecision).toHaveBeenCalledWith(GOV, DECISION, "Not enough evidence");
  });

  it("escalates a decision", async () => {
    escalateDecision.mockResolvedValue({ decisionId: DECISION, status: "escalated" });
    const res = await POST(
      request({ action: "escalate", decisionId: DECISION, rationale: "Needs admin" })
    );
    expect(res.status).toBe(200);
    expect(escalateDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: DECISION, actorId: GOV })
    );
  });

  it("returns 500 without details when the database fails", async () => {
    approveDecision.mockRejectedValue(new Error("Decision RPC approve_decision failed"));
    const res = await POST(
      request({ action: "approve", decisionId: DECISION, payloadVersion: 1, rationale: "ok" })
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("approve_decision");
  });
});

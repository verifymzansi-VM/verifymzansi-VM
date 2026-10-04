// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createPlaywrightSession,
  listPlaywrightTableRows,
  writePlaywrightTableRows,
} from "./playwright-fixture-store";
import { handlePlaywrightKycDecisionRpc as rpc } from "./playwright-governance";

function fixture() {
  const proposer = createPlaywrightSession(`kyc-governor-${crypto.randomUUID()}`).user;
  const approver = createPlaywrightSession(`kyc-governor-${crypto.randomUUID()}`).user;
  const member = createPlaywrightSession(`kyc-member-${crypto.randomUUID()}`).user;
  const step = {
    id: crypto.randomUUID(),
    user_id: member.id,
    step_type: "selfie",
    status: "pending",
    risk_level: "high",
    updated_at: "2026-10-04T10:00:00.123456Z",
  };
  writePlaywrightTableRows("verification_steps", [
    ...listPlaywrightTableRows("verification_steps"),
    step,
  ]);
  const input = {
    p_actor: proposer.id,
    p_step: step.id,
    p_user: member.id,
    p_risk_level: "high",
    p_override_reason: "verified_in_person",
    p_expected_updated_at: step.updated_at,
  };
  return { proposer, approver, member, step, input };
}
function propose(input: Record<string, unknown>) {
  const result = rpc("propose_kyc_override", input)!;
  expect(result).toMatchObject({ ok: true, status: "proposed" });
  return result.decision_id as string;
}
describe("isolated KYC governance model", () => {
  it("requires current database authority rather than metadata", () => {
    const { member, input } = fixture();
    member.app_metadata.role = "admin";
    expect(rpc("propose_kyc_override", { ...input, p_actor: member.id })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
  it("refuses mismatched owner, stale microseconds, missing version and ordinary-risk proposals", () => {
    const { input } = fixture();
    for (const patch of [
      { p_user: crypto.randomUUID() },
      { p_expected_updated_at: "2026-10-04T10:00:00.123455Z" },
      { p_expected_updated_at: null },
      { p_risk_level: "low" },
    ]) {
      expect(rpc("propose_kyc_override", { ...input, ...patch })).toEqual({
        ok: false,
        error: "step_changed",
      });
    }
  });
  it("requires independent approval and the exact proposal version", () => {
    const { proposer, approver, input, step } = fixture();
    const id = propose(input);
    expect(rpc("propose_kyc_override", input)).toEqual({ ok: false, error: "pending_exists" });
    const approve = {
      p_actor: approver.id,
      p_decision: id,
      p_payload_version: 1,
      p_note: "Synthetic review",
    };
    expect(rpc("approve_decision", { ...approve, p_actor: proposer.id })).toEqual({
      ok: false,
      error: "not_independent",
    });
    expect(rpc("approve_decision", { ...approve, p_payload_version: 2 })).toEqual({
      ok: false,
      error: "payload_changed",
    });
    expect(rpc("approve_decision", approve)).toMatchObject({
      ok: true,
      execution: "pending",
      payload: { step_id: step.id, step_updated_at: step.updated_at },
    });
    expect(
      listPlaywrightTableRows("verification_steps").find((row) => row.id === step.id)?.status
    ).toBe("pending");
    expect(
      listPlaywrightTableRows("decision_records").find((row) => row.id === id)?.approver_id
    ).toBe(approver.id);
    rpc("mark_decision_execution", {
      p_decision: id,
      p_ok: false,
      p_error: "temporary fixture failure",
    });
    expect(
      listPlaywrightTableRows("decision_records").find((row) => row.id === id)?.execution_status
    ).toBe("failed");
    rpc("mark_decision_execution", { p_decision: id, p_ok: true });
    expect(
      listPlaywrightTableRows("decision_records").find((row) => row.id === id)?.execution_status
    ).toBe("succeeded");
    expect(rpc("approve_decision", approve)).toEqual({ ok: false, error: "not_pending" });
  });
  it("refuses replaced submissions without recording approval", () => {
    const { input, step, approver } = fixture();
    const id = propose(input);
    writePlaywrightTableRows(
      "verification_steps",
      listPlaywrightTableRows("verification_steps").map((row) =>
        row.id === step.id ? { ...row, updated_at: "2026-10-04T10:00:00.123457Z" } : row
      )
    );
    expect(
      rpc("approve_decision", { p_actor: approver.id, p_decision: id, p_payload_version: 1 })
    ).toEqual({ ok: false, error: "step_changed" });
    expect(
      listPlaywrightTableRows("decision_approvals").some((row) => row.decision_id === id)
    ).toBe(false);
  });
  it("refuses revoked staff and marks expired proposals", () => {
    const { input, approver } = fixture();
    const id = propose(input);
    writePlaywrightTableRows(
      "staff_roles",
      listPlaywrightTableRows("staff_roles").map((row) =>
        row.user_id === approver.id ? { ...row, status: "revoked" } : row
      )
    );
    const approve = { p_actor: approver.id, p_decision: id, p_payload_version: 1 };
    expect(rpc("approve_decision", approve)).toEqual({ ok: false, error: "forbidden" });
    writePlaywrightTableRows(
      "decision_records",
      listPlaywrightTableRows("decision_records").map((row) =>
        row.id === id ? { ...row, expires_at: new Date(Date.now() - 1000).toISOString() } : row
      )
    );
    expect(rpc("approve_decision", approve)).toEqual({ ok: false, error: "expired" });
  });
});

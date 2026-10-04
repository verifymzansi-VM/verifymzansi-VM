import "server-only";
import {
  createPlaywrightTableRow,
  listPlaywrightTableRows,
  writePlaywrightTableRows,
} from "./playwright-fixture-store";

type Row = Record<string, unknown>;
const staffRoles = new Set(["moderator", "governance_controller", "admin"]);
function roleOf(actor: unknown) {
  const role = listPlaywrightTableRows("staff_roles").find(
    (row) => row.user_id === actor && row.status === "active"
  );
  const profile = listPlaywrightTableRows("account_profiles").find((row) => row.user_id === actor);
  return role &&
    profile &&
    !["banned", "suspended"].includes(String(profile.account_status)) &&
    staffRoles.has(String(role.role))
    ? String(role.role)
    : null;
}
function append(table: string, row: Row) {
  writePlaywrightTableRows(table, [
    ...listPlaywrightTableRows(table),
    createPlaywrightTableRow(table, row),
  ]);
}
function replaceDecision(id: unknown, patch: Row) {
  writePlaywrightTableRows(
    "decision_records",
    listPlaywrightTableRows("decision_records").map((row) =>
      row.id === id ? { ...row, ...patch, updated_at: new Date().toISOString() } : row
    )
  );
}
const refused = (error: string) => ({ ok: false, error });

/** KYC-only local fixture model. Real SQL/RLS/transactions remain separate evidence. */
export function handlePlaywrightKycDecisionRpc(
  fn: string,
  params: Row = {}
): Row | null | undefined {
  if (!["propose_kyc_override", "approve_decision", "mark_decision_execution"].includes(fn))
    return undefined;
  const actor = params.p_actor;
  const role = roleOf(actor);
  if (fn === "propose_kyc_override") {
    if (!role) return refused("forbidden");
    if (actor === params.p_user) return refused("not_independent");
    if (!String(params.p_override_reason ?? "").trim()) return refused("reason_required");
    const step = listPlaywrightTableRows("verification_steps").find(
      (row) => row.id === params.p_step
    );
    if (
      !step ||
      step.user_id !== params.p_user ||
      !params.p_expected_updated_at ||
      step.updated_at !== params.p_expected_updated_at ||
      step.risk_level !== params.p_risk_level ||
      !["high", "critical"].includes(String(step.risk_level)) ||
      !["pending", "needs_resubmission"].includes(String(step.status))
    )
      return refused("step_changed");
    if (
      listPlaywrightTableRows("decision_records").some(
        (row) =>
          row.case_type === "verification_step" &&
          row.case_id === step.id &&
          ["pending_approval", "escalated"].includes(String(row.status))
      )
    )
      return refused("pending_exists");
    const decision = createPlaywrightTableRow("decision_records", {
      case_type: "verification_step",
      case_id: step.id,
      action_category: "kyc_override",
      status: "pending_approval",
      recommender_id: actor,
      recommendation: "approve",
      rationale: params.p_note || params.p_override_reason,
      payload_version: 1,
      correlation_id: crypto.randomUUID(),
      execution_status: "not_required",
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      evidence_refs: [step.id],
      before_state: { stepId: step.id, ownerId: step.user_id, riskLevel: step.risk_level },
      payload: {
        step_id: step.id,
        user_id: step.user_id,
        risk_level: step.risk_level,
        override_reason_code: params.p_override_reason,
        step_updated_at: step.updated_at,
      },
    });
    writePlaywrightTableRows("decision_records", [
      ...listPlaywrightTableRows("decision_records"),
      decision,
    ]);
    append("decision_record_events", {
      decision_id: decision.id,
      actor_id: actor,
      actor_role: role,
      event_type: "recommended",
      detail: { override_reason_code: params.p_override_reason },
    });
    return { ok: true, status: "proposed", decision_id: decision.id };
  }
  const decision = listPlaywrightTableRows("decision_records").find(
    (row) => row.id === params.p_decision
  );
  if (fn === "mark_decision_execution") {
    if (
      decision?.action_category === "kyc_override" &&
      decision.status === "approved" &&
      ["pending", "failed"].includes(String(decision.execution_status))
    ) {
      replaceDecision(decision.id, {
        execution_status: params.p_ok ? "succeeded" : "failed",
        execution_error: params.p_ok ? null : String(params.p_error ?? "").slice(0, 500),
        ...(params.p_ok ? { executed_at: new Date().toISOString() } : {}),
      });
    }
    return null;
  }
  if (!decision || decision.case_type === "staff_role") return refused("not_found");
  if (!["pending_approval", "escalated"].includes(String(decision.status)))
    return refused("not_pending");
  if (
    decision.expires_at != null &&
    (!Number.isFinite(Date.parse(String(decision.expires_at))) ||
      Date.parse(String(decision.expires_at)) <= Date.now())
  ) {
    replaceDecision(decision.id, { status: "expired", decided_at: new Date().toISOString() });
    return refused("expired");
  }
  if (!["governance_controller", "admin"].includes(String(role))) return refused("forbidden");
  if (decision.action_category !== "kyc_override") return refused("unsupported_decision");
  if (!decision.payload || typeof decision.payload !== "object" || Array.isArray(decision.payload))
    return refused("step_changed");
  const payload = decision.payload as Row;
  if (
    actor === payload.user_id ||
    actor === decision.recommender_id ||
    actor === decision.approver_id ||
    listPlaywrightTableRows("decision_approvals").some(
      (row) => row.decision_id === decision.id && row.approver_id === actor
    )
  )
    return refused("not_independent");
  if (params.p_payload_version !== decision.payload_version) return refused("payload_changed");
  const step = listPlaywrightTableRows("verification_steps").find(
    (row) => row.id === payload.step_id
  );
  if (
    !step ||
    step.user_id !== payload.user_id ||
    !payload.step_updated_at ||
    step.updated_at !== payload.step_updated_at ||
    !["pending", "needs_resubmission"].includes(String(step.status))
  )
    return refused("step_changed");
  replaceDecision(decision.id, {
    status: "approved",
    approver_id: actor,
    approval_rationale: params.p_note,
    decided_at: new Date().toISOString(),
    execution_status: "pending",
  });
  append("decision_approvals", {
    decision_id: decision.id,
    approver_id: actor,
    approver_role: role,
    payload_version: decision.payload_version,
  });
  append("decision_record_events", {
    decision_id: decision.id,
    actor_id: actor,
    actor_role: role,
    event_type: "approved",
    detail: { note: params.p_note },
  });
  return { ok: true, status: "approved", decision_id: decision.id, execution: "pending", payload };
}

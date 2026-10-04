import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "./audit";
import { createLogger } from "@/lib/utils/logger";
import type { DecisionStatus, StaffRole } from "@/types/enums";

const log = createLogger("DecisionLedger");

/**
 * The decision ledger. Every enforcement decision, appeal and lift runs in
 * one database transaction (see 20260927120000_decision_execution_layer.sql):
 * the state change, recorded effects, events and audit row commit together
 * or not at all. These wrappers pass the verified actor from the server
 * route; the database re-checks their role and independence.
 */

export type DecisionResult<T extends Record<string, unknown> = Record<string, unknown>> =
  ({ ok: true; status: string } & T) | { ok: false; error: string };

async function callDecisionRpc<T extends Record<string, unknown>>(
  fn: string,
  args: Record<string, unknown>
): Promise<DecisionResult<T>> {
  const { data, error } = await createAdminClient().rpc(fn, args);
  if (error) {
    log.error("Decision RPC failed", { fn, error: error.message });
    throw new Error(`Decision RPC ${fn} failed`);
  }
  return data as DecisionResult<T>;
}

export type ReportAction = "dismiss" | "warn" | "hide" | "suspend" | "ban";

export function moderateReport(
  actorId: string,
  input: {
    reportId: string;
    action: ReportAction;
    reason: string | null;
    durationDays?: number | null;
    emergency?: boolean;
  }
) {
  return callDecisionRpc<{ decision_id?: string; review_decision_id?: string }>("moderate_report", {
    p_actor: actorId,
    p_report: input.reportId,
    p_action: input.action,
    p_reason: input.reason,
    p_duration_days: input.durationDays ?? null,
    p_emergency: input.emergency ?? false,
  });
}

export function approveDecision(
  actorId: string,
  decisionId: string,
  payloadVersion: number,
  note: string
) {
  return callDecisionRpc<{
    decision_id: string;
    execution?: "pending";
    payload?: Record<string, unknown>;
  }>("approve_decision", {
    p_actor: actorId,
    p_decision: decisionId,
    p_payload_version: payloadVersion,
    p_note: note,
  });
}

export function rejectDecision(actorId: string, decisionId: string, note: string) {
  return callDecisionRpc("reject_decision", {
    p_actor: actorId,
    p_decision: decisionId,
    p_note: note,
  });
}

export function liftRestriction(actorId: string, restrictionId: string, reason: string) {
  return callDecisionRpc<{ decision_id: string }>("lift_restriction", {
    p_actor: actorId,
    p_restriction: restrictionId,
    p_reason: reason,
  });
}

export function submitAppeal(
  userId: string,
  decisionId: string,
  reason: string,
  evidence: string[] = []
) {
  return callDecisionRpc<{ appeal_id: string }>("submit_appeal", {
    p_user: userId,
    p_decision: decisionId,
    p_reason: reason,
    p_evidence: evidence,
  });
}

export type AppealOutcome = "upheld" | "overturned" | "partially_overturned" | "dismissed";

export function resolveAppeal(
  actorId: string,
  appealId: string,
  outcome: AppealOutcome,
  rationale: string,
  shortenTo?: string | null
) {
  return callDecisionRpc<{ restrictions_changed: number }>("resolve_appeal", {
    p_actor: actorId,
    p_appeal: appealId,
    p_outcome: outcome,
    p_rationale: rationale,
    p_shorten_to: shortenTo ?? null,
  });
}

/** Record the outcome of application-side work for an approved decision. */
export async function markDecisionExecution(decisionId: string, ok: boolean, error?: string) {
  const { error: rpcError } = await createAdminClient().rpc("mark_decision_execution", {
    p_decision: decisionId,
    p_ok: ok,
    p_error: error ?? null,
  });
  if (rpcError) {
    log.error("Failed to record decision execution", { decisionId, error: rpcError.message });
  }
}

/** How each refusal from the decision RPCs is shown to staff and members. */
const REFUSALS: Record<string, [number, string]> = {
  forbidden: [403, "Your role cannot make this decision."],
  not_independent: [
    403,
    "Someone who took no part in this case, and is not the person affected or the reporter, must decide it.",
  ],
  not_found: [404, "That case could not be found."],
  already_actioned: [409, "Someone has already acted on this report."],
  not_pending: [409, "This has already been decided."],
  expired: [410, "This proposal expired. Propose it again if it is still needed."],
  payload_changed: [409, "The proposal changed after you opened it. Refresh and review it again."],
  step_changed: [409, "The submission changed after review. Request a new review."],
  invalid_action: [400, "Choose a valid action."],
  invalid_duration: [400, "Suspensions last between 1 and 30 days."],
  target_missing: [404, "The reported content or account no longer exists."],
  unmappable_hide_target: [422, "This kind of report target cannot be hidden."],
  unsupported_decision: [422, "This decision cannot be approved here."],
  reason_required: [400, "Give a reason of at least 10 characters."],
  not_active: [409, "This restriction is no longer active."],
  invalid_outcome: [400, "Choose a valid outcome."],
  shorten_to_required: [400, "Choose the new end date for a partial overturn."],
  nothing_to_shorten: [409, "There is no active suspension to shorten."],
  reason_length: [400, "Explain your appeal in 20 to 2000 characters."],
  too_much_evidence: [400, "Attach at most 5 pieces of evidence."],
  not_appealable: [409, "This decision cannot be appealed."],
  appeal_open: [409, "You already have an open appeal for this decision."],
  already_appealed: [
    409,
    "This decision has already been appealed. Contact support if something new has come up.",
  ],
};

export function decisionRefusalResponse(error: string): NextResponse {
  const [status, message] = REFUSALS[error] ?? [400, "This action was refused."];
  return NextResponse.json({ error: message, code: error }, { status });
}

/* ── Escalation ────────────────────────────────────────── */

export interface EscalateDecisionParams {
  decisionId: string;
  actorId: string;
  actorRole: StaffRole;
  reason: string;
}

/** Flag a pending decision for a senior reviewer; it stays approvable. */
export async function escalateDecision(params: EscalateDecisionParams) {
  const supabase = createAdminClient();

  const { data: updatedRows, error } = await supabase
    .from("decision_records")
    .update({ status: "escalated" as DecisionStatus })
    .eq("id", params.decisionId)
    .in("status", ["recommended", "pending_approval"])
    .neq("case_type", "staff_role")
    .select("id");

  if (error) {
    throw new Error("Failed to escalate decision");
  }
  if (!updatedRows || updatedRows.length === 0) {
    return null;
  }

  const { error: eventError } = await supabase.from("decision_record_events").insert({
    decision_id: params.decisionId,
    actor_id: params.actorId,
    actor_role: params.actorRole,
    event_type: "escalated",
    detail: { reason: params.reason },
  });
  if (eventError) {
    log.error("Failed to append decision event", {
      decisionId: params.decisionId,
      error: eventError.message,
    });
  }

  await logAuditEvent({
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: "decision_escalated",
    targetType: "decision",
    targetId: params.decisionId,
    metadata: { reason: params.reason },
  });

  return { decisionId: params.decisionId, status: "escalated" };
}

/* ── Query Helpers ─────────────────────────────────────── */

/**
 * Get pending decisions awaiting governance approval.
 */
export async function getPendingDecisions(limit = 50) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("decision_records")
    .select("*")
    .in("status", ["pending_approval", "escalated"])
    // Staff role changes have their own review flow on the Role management page.
    .neq("case_type", "staff_role")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error("Failed to fetch pending decisions");
  }

  return data;
}

/**
 * Get pending appeals awaiting review.
 */
export async function getPendingAppeals(limit = 50) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("appeal_cases")
    .select(
      `
      *,
      decision_records(*)
    `
    )
    .in("status", ["submitted", "under_review"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error("Failed to fetch pending appeals");
  }

  return data;
}

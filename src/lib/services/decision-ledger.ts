/**
 * Decision Ledger Service.
 * Manages the recommendation → approval chain for sensitive actions.
 * All decision records are immutable once finalized.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "./audit";
import { createLogger } from "@/lib/utils/logger";
import type {
  DecisionStatus,
  SensitiveActionCategory,
  AppealStatus,
  StaffRole,
} from "@/types/enums";

const log = createLogger("DecisionLedger");

/* ── Types ─────────────────────────────────────────────── */

export interface CreateDecisionParams {
  caseType: string;
  caseId: string;
  actionCategory: SensitiveActionCategory;
  recommenderId: string;
  recommenderRole: StaffRole;
  recommendation: string;
  rationale: string;
  evidenceRefs?: string[];
  policyClause?: string;
  beforeState: Record<string, unknown>;
  correlationId?: string;
  parentDecisionId?: string;
}

export interface ApproveDecisionParams {
  decisionId: string;
  approverId: string;
  approverRole: StaffRole;
  rationale: string;
  afterState: Record<string, unknown>;
  secondaryApproverId?: string;
}

export interface RejectDecisionParams {
  decisionId: string;
  approverId: string;
  approverRole: StaffRole;
  rationale: string;
}

export interface EscalateDecisionParams {
  decisionId: string;
  actorId: string;
  actorRole: StaffRole;
  reason: string;
}

export interface CreateAppealParams {
  decisionId: string;
  appellantId: string;
  reason: string;
  evidenceRefs?: string[];
}

export interface ResolveAppealParams {
  appealId: string;
  reviewerId: string;
  reviewerRole: StaffRole;
  status: Extract<AppealStatus, "upheld" | "overturned" | "partially_overturned" | "dismissed">;
  rationale: string;
  outcomeDetail?: Record<string, unknown>;
}

/* ── Decision Lifecycle ────────────────────────────────── */

/**
 * Create a new decision record (recommendation from a moderator).
 * Status starts as "recommended" and moves to "pending_approval".
 */
export async function createDecisionRecord(params: CreateDecisionParams) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("decision_records")
    .insert({
      case_type: params.caseType,
      case_id: params.caseId,
      action_category: params.actionCategory,
      status: "pending_approval" as DecisionStatus,
      recommender_id: params.recommenderId,
      recommendation: params.recommendation,
      rationale: params.rationale,
      evidence_refs: params.evidenceRefs ?? [],
      policy_clause: params.policyClause ?? null,
      before_state: params.beforeState,
      correlation_id: params.correlationId ?? undefined,
      parent_decision_id: params.parentDecisionId ?? null,
    })
    .select("id, correlation_id")
    .single();

  if (error || !data) {
    log.error("Failed to create decision record", {
      caseType: params.caseType,
      caseId: params.caseId,
      error: error?.message,
    });
    throw new Error("Failed to create decision record");
  }

  // Log immutable event
  await appendDecisionEvent(data.id, params.recommenderId, params.recommenderRole, "recommended", {
    recommendation: params.recommendation,
    rationale: params.rationale,
  });

  // Audit trail
  await logAuditEvent({
    actorId: params.recommenderId,
    actorRole: params.recommenderRole,
    action: "decision_recommended",
    targetType: params.caseType,
    targetId: params.caseId,
    metadata: {
      decisionId: data.id,
      actionCategory: params.actionCategory,
      correlationId: data.correlation_id,
    },
  });

  return data;
}

/**
 * Approve a pending decision (governance controller action).
 */
export async function approveDecision(params: ApproveDecisionParams) {
  const supabase = createAdminClient();

  const { data: decision, error: fetchError } = await supabase
    .from("decision_records")
    .select("id, status, case_type, case_id, recommender_id")
    .eq("id", params.decisionId)
    .single();

  if (fetchError || !decision) {
    throw new Error("Decision record not found");
  }

  if (decision.status !== "pending_approval" && decision.status !== "escalated") {
    throw new Error(`Cannot approve decision in status: ${decision.status}`);
  }

  const { error } = await supabase
    .from("decision_records")
    .update({
      status: "approved" as DecisionStatus,
      approver_id: params.approverId,
      approval_rationale: params.rationale,
      secondary_approver_id: params.secondaryApproverId ?? null,
      after_state: params.afterState,
      decided_at: new Date().toISOString(),
    })
    .eq("id", params.decisionId);

  if (error) {
    throw new Error("Failed to approve decision");
  }

  await appendDecisionEvent(params.decisionId, params.approverId, params.approverRole, "approved", {
    rationale: params.rationale,
    afterState: params.afterState,
  });

  await logAuditEvent({
    actorId: params.approverId,
    actorRole: params.approverRole,
    action: "decision_approved",
    targetType: decision.case_type,
    targetId: decision.case_id,
    metadata: {
      decisionId: params.decisionId,
      recommenderId: decision.recommender_id,
    },
  });

  return { decisionId: params.decisionId, status: "approved" };
}

/**
 * Reject a pending decision (governance controller action).
 */
export async function rejectDecision(params: RejectDecisionParams) {
  const supabase = createAdminClient();

  const { data: decision, error: fetchError } = await supabase
    .from("decision_records")
    .select("id, status, case_type, case_id")
    .eq("id", params.decisionId)
    .single();

  if (fetchError || !decision) {
    throw new Error("Decision record not found");
  }

  if (decision.status !== "pending_approval" && decision.status !== "escalated") {
    throw new Error(`Cannot reject decision in status: ${decision.status}`);
  }

  const { error } = await supabase
    .from("decision_records")
    .update({
      status: "rejected" as DecisionStatus,
      approver_id: params.approverId,
      approval_rationale: params.rationale,
      decided_at: new Date().toISOString(),
    })
    .eq("id", params.decisionId);

  if (error) {
    throw new Error("Failed to reject decision");
  }

  await appendDecisionEvent(params.decisionId, params.approverId, params.approverRole, "rejected", {
    rationale: params.rationale,
  });

  await logAuditEvent({
    actorId: params.approverId,
    actorRole: params.approverRole,
    action: "decision_rejected",
    targetType: decision.case_type,
    targetId: decision.case_id,
    metadata: { decisionId: params.decisionId },
  });

  return { decisionId: params.decisionId, status: "rejected" };
}

/**
 * Escalate a decision for additional review.
 */
export async function escalateDecision(params: EscalateDecisionParams) {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("decision_records")
    .update({ status: "escalated" as DecisionStatus })
    .eq("id", params.decisionId);

  if (error) {
    throw new Error("Failed to escalate decision");
  }

  await appendDecisionEvent(params.decisionId, params.actorId, params.actorRole, "escalated", {
    reason: params.reason,
  });

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

/* ── Appeals ───────────────────────────────────────────── */

/** Maximum depth of appeal chains to prevent infinite loops. */
const MAX_APPEAL_DEPTH = 3;

/**
 * Submit an appeal against a finalized decision.
 */
export async function createAppeal(params: CreateAppealParams) {
  const supabase = createAdminClient();

  // Enforce appeal depth limit by walking the parent_decision_id chain.
  const { data: decision } = await supabase
    .from("decision_records")
    .select("id, parent_decision_id")
    .eq("id", params.decisionId)
    .single();

  if (!decision) {
    throw new Error("Decision record not found");
  }

  let depth = 0;
  let parentId = decision.parent_decision_id as string | null;
  while (parentId && depth < MAX_APPEAL_DEPTH + 1) {
    depth++;
    const { data: parent } = await supabase
      .from("decision_records")
      .select("parent_decision_id")
      .eq("id", parentId)
      .single();
    parentId = (parent?.parent_decision_id as string | null) ?? null;
  }

  if (depth >= MAX_APPEAL_DEPTH) {
    throw new Error(
      `Maximum appeal depth of ${MAX_APPEAL_DEPTH} reached. Please contact support for further assistance.`
    );
  }

  // Mark the parent decision as appealed
  await supabase
    .from("decision_records")
    .update({ status: "appealed" as DecisionStatus })
    .eq("id", params.decisionId);

  const { data, error } = await supabase
    .from("appeal_cases")
    .insert({
      decision_id: params.decisionId,
      appellant_id: params.appellantId,
      reason: params.reason,
      evidence_refs: params.evidenceRefs ?? [],
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Failed to create appeal");
  }

  await logAuditEvent({
    actorId: params.appellantId,
    actorRole: "member",
    action: "appeal_submitted",
    targetType: "decision",
    targetId: params.decisionId,
    metadata: { appealId: data.id },
  });

  return data;
}

/**
 * Resolve an appeal (governance controller action).
 */
export async function resolveAppeal(params: ResolveAppealParams) {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("appeal_cases")
    .update({
      status: params.status,
      reviewer_id: params.reviewerId,
      reviewer_rationale: params.rationale,
      outcome_detail: params.outcomeDetail ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", params.appealId);

  if (error) {
    throw new Error("Failed to resolve appeal");
  }

  await logAuditEvent({
    actorId: params.reviewerId,
    actorRole: params.reviewerRole,
    action: params.status === "upheld" ? "appeal_upheld" : "appeal_overturned",
    targetType: "appeal",
    targetId: params.appealId,
    metadata: {
      status: params.status,
      rationale: params.rationale,
    },
  });

  return { appealId: params.appealId, status: params.status };
}

/* ── Role Assignment History ───────────────────────────── */

/**
 * Record a role change in the role assignments history.
 */
export async function recordRoleChange(params: {
  targetUserId: string;
  previousRole: string | null;
  newRole: string;
  assignedBy: string;
  assignerRole: StaffRole;
  reason: string;
}) {
  const supabase = createAdminClient();

  const { error } = await supabase.from("role_assignments_history").insert({
    target_user_id: params.targetUserId,
    previous_role: params.previousRole,
    new_role: params.newRole,
    assigned_by: params.assignedBy,
    reason: params.reason,
  });

  if (error) {
    log.error("Failed to record role change", { error: error.message });
    throw new Error("Failed to record role change");
  }

  await logAuditEvent({
    actorId: params.assignedBy,
    actorRole: params.assignerRole,
    action: "role_assigned",
    targetType: "user",
    targetId: params.targetUserId,
    metadata: {
      previousRole: params.previousRole,
      newRole: params.newRole,
      reason: params.reason,
    },
  });
}

/* ── Query Helpers ─────────────────────────────────────── */

/**
 * Get the full decision timeline for a case.
 */
export async function getDecisionTimeline(caseType: string, caseId: string) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("decision_records")
    .select(
      `
      *,
      decision_record_events(*)
    `
    )
    .eq("case_type", caseType)
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("Failed to fetch decision timeline");
  }

  return data;
}

/**
 * Get pending decisions awaiting governance approval.
 */
export async function getPendingDecisions(limit = 50) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("decision_records")
    .select("*")
    .in("status", ["pending_approval", "escalated"])
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

/* ── Internal Helpers ──────────────────────────────────── */

async function appendDecisionEvent(
  decisionId: string,
  actorId: string,
  actorRole: string,
  eventType: string,
  detail: Record<string, unknown>
) {
  const supabase = createAdminClient();

  const { error } = await supabase.from("decision_record_events").insert({
    decision_id: decisionId,
    actor_id: actorId,
    actor_role: actorRole,
    event_type: eventType,
    detail,
  });

  if (error) {
    log.error("Failed to append decision event", {
      decisionId,
      eventType,
      error: error.message,
    });
  }
}

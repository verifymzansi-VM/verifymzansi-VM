import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { foundationDecisionPage } from "./staff-read";
import { settleStaffCommand } from "./staff-command";

export const governanceScopeSchema = z.strictObject({
  caseId: z.uuid(),
  caseVersion: z.number().int().min(1).max(2147483647),
  proposalVersion: z.number().int().min(1).max(2147483647),
});
export type GovernanceScope = z.infer<typeof governanceScopeSchema>;
const event = z.strictObject({
  id: z.uuid(),
  actor_id: z.uuid().nullable(),
  action: z.enum(["approve", "reject", "withdraw", "escalate"]),
  reason: z.string().min(1).max(2000),
  created_at: z.iso.datetime({ offset: true }),
});
const resultSchema = z
  .strictObject({
    native: foundationDecisionPage,
    presentation: z
      .array(
        z.strictObject({
          decision_id: z.uuid(),
          recommendation: z.string().min(1).max(2000),
          report_id: z.uuid().nullable().optional(),
          display_category: z.enum(["account_suspend", "account_ban"]).nullable().optional(),
          proposal_expired: z.boolean().optional(),
          reporter_conflict: z.boolean().optional(),
          events: z.array(event).max(4),
        })
      )
      .max(100),
  })
  .refine(
    (v) =>
      new Set(v.presentation.map((r) => r.decision_id)).size === v.presentation.length &&
      v.presentation.length === v.native.items.length &&
      v.presentation.every((p) => v.native.items.some((d) => d.id === p.decision_id))
  );

/** The preserved queue receives facts from the caller-bound native read only.
 * A rejected proposal is natively closed as withdrawn; the extra event records
 * that rejection without inventing a successful identity/access change. */
export async function readRestoredGovernance(
  api: FoundationAuthenticatedApi,
  callerId: string,
  request: { limit?: number; id?: string; status?: "proposed" | "all" } = {}
) {
  const parsedRequest = z
    .strictObject({
      limit: z.number().int().min(1).max(100).optional(),
      id: z.uuid().optional(),
      status: z.enum(["proposed", "all"]).optional(),
    })
    .parse(request);
  const result = await settleStaffCommand(
    api.rpc("get_frontend_governance_page", { p_request: parsedRequest }, { get: false }),
    resultSchema.refine(
      (v) =>
        v.native.caller_id === callerId &&
        v.native.items.every(
          (d) =>
            (!request.id || d.id === request.id) &&
            (request.status === "all" || d.status === "proposed")
        )
    )
  );
  return result.native.items.map((d) => {
    const annotation = result.presentation.find((p) => p.decision_id === d.id)!;
    const final = annotation.events.find((e) =>
      ["approve", "reject", "withdraw"].includes(e.action)
    );
    if (
      final &&
      ((final.action === "approve" &&
        (d.status !== "approved" || final.actor_id !== d.approved_by)) ||
        (final.action !== "approve" &&
          (d.status !== "withdrawn" || final.actor_id !== d.withdrawn_by)))
    )
      throw new Error("Governance outcome could not be confirmed");
    const escalated = annotation.events.some((e) => e.action === "escalate");
    const status =
      d.status === "proposed"
        ? annotation.proposal_expired
          ? "expired"
          : escalated
            ? "escalated"
            : "pending_approval"
        : d.status === "withdrawn" && final?.action === "reject"
          ? "rejected"
          : d.status;
    const timeline: Array<{
      id: string;
      event_type: string;
      detail: Record<string, unknown>;
      created_at: string;
    }> = [
      {
        id: `proposal:${d.id}`,
        event_type: "proposed",
        detail: { actor_id: d.proposed_by, action: d.action },
        created_at: d.proposed_at,
      },
    ];
    for (const e of annotation.events)
      timeline.push({
        id: e.id,
        event_type: e.action,
        detail: { actor_id: e.actor_id, reason: e.reason },
        created_at: e.created_at,
      });
    if (d.status === "approved" && !final)
      timeline.push({
        id: `approved:${d.id}`,
        event_type: "approved",
        detail: { actor_id: d.approved_by },
        created_at: d.approved_at!,
      });
    if (d.status === "withdrawn" && !final)
      timeline.push({
        id: `withdrawn:${d.id}`,
        event_type: "withdrawn",
        detail: { actor_id: d.withdrawn_by, reason: d.withdrawal_reason },
        created_at: d.withdrawn_at!,
      });
    timeline.sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id)
    );
    return {
      id: d.id,
      case_id: annotation.report_id ?? d.case_id,
      case_type: annotation.report_id ? "report" : d.case_kind,
      action_category: annotation.display_category ?? d.action,
      status,
      recommender_id: d.proposed_by,
      approver_id: d.approved_by,
      correlation_id: null,
      created_at: d.proposed_at,
      recommendation: annotation.recommendation,
      approval_rationale: final?.action === "approve" ? final.reason : null,
      decided_at: d.approved_at ?? d.withdrawn_at,
      payload_version: d.current_case_version,
      execution_status: d.status === "approved" ? "completed" : null,
      foundation: {
        caseId: d.case_id,
        caseVersion: d.current_case_version,
        proposalVersion: d.case_version,
      },
      blockedReason: annotation.reporter_conflict
        ? "You submitted this report. Another reviewer must decide it."
        : d.subject_id === callerId
          ? "You cannot decide a case affecting your own account."
          : null,
      timeline,
    };
  });
}

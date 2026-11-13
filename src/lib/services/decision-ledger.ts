import { NextResponse } from "next/server";

/** How each refusal from the decision commands is shown to staff and members. */
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

/**
 * Get pending decisions awaiting governance approval.
 */
export async function getPendingDecisions(limit = 50) {
  const { readRestoredGovernancePage } = await import("@/lib/foundation/governance-server");
  return readRestoredGovernancePage(limit);
}

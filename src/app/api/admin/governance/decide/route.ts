import { type NextRequest } from "next/server";
import { handleRestoredGovernanceDecision } from "@/lib/foundation/restored-governance-route";

/**
 * POST /api/admin/governance/decide
 *
 * Approve, reject or escalate a pending decision, or retry the execution of
 * an approved one. Approval runs in one database transaction that checks
 * the approver's role and independence (not the proposer, the person
 * affected, the reporter or anyone who already took part) and applies the
 * decision's effects. KYC overrides then run the verification workflow and
 * record whether it succeeded; a failure stays visible and retryable.
 */
export async function POST(request: Request) {
  return handleRestoredGovernanceDecision(request as NextRequest);
}

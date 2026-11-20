import "server-only";

import { z } from "zod";
import type { AccountVerificationStatus } from "@/types/enums";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { foundationVerificationStatusSchema } from "./verification-status";

type VerificationCase = z.infer<typeof foundationVerificationStatusSchema>;
type ReturnDecision = "rejected" | "needs_resubmission" | null;

/**
 * The page status (`verified`, `pending_review`, `rejected`, `incomplete`)
 * for the member's own verification case. It gives the same answer as
 * GET /api/verification/status (restored-verification-route.ts), which the
 * post-create page asks again in the browser:
 * - verified: the identity is accepted and the phone and area are proven;
 * - rejected: the review sent the case back as rejected;
 * - incomplete: sent back to fix and resubmit, or something not yet done;
 * - pending_review: ID and selfie waiting for review, phone and area proven.
 */
export function accountVerificationStatusFromCase(
  current: VerificationCase,
  decision: ReturnDecision
): AccountVerificationStatus {
  if (current.verified) return "verified";
  if (current.return_reason !== null) return decision === "rejected" ? "rejected" : "incomplete";
  if (current.submission_pending && current.phone_verified && current.locality_confirmed)
    return "pending_review";
  return "incomplete";
}

const identityDecisionSchema = z.object({
  case_id: z.uuid().nullable(),
  case_version: z.number().int().positive().nullable(),
  reason: z.string().nullable(),
  decision: z.enum(["rejected", "needs_resubmission"]).nullable(),
});

/** Reads the signed-in member's verification case from the live backend. Any
 * failure or inconsistent answer throws: the caller decides what to show. */
export async function readFoundationAccountVerificationStatus(
  api: FoundationAuthenticatedApi
): Promise<AccountVerificationStatus> {
  const read = await api.rpc("get_my_verification_case", {}, { get: false });
  if (read.error) throw new Error("Verification case unavailable");
  const current = foundationVerificationStatusSchema.parse(read.data);
  if (current.return_reason === null) return accountVerificationStatusFromCase(current, null);
  // Only a returned case needs to know whether it was rejected or sent back to fix.
  const identity = await api.rpc("get_my_frontend_identity_state", {}, { get: false });
  if (identity.error) throw new Error("Verification decision unavailable");
  const state = identityDecisionSchema.parse(identity.data);
  if (
    state.case_id !== current.case_id ||
    state.case_version !== current.version ||
    state.reason !== current.return_reason
  )
    throw new Error("Verification case changed");
  return accountVerificationStatusFromCase(current, state.decision);
}

import "server-only";

import { readMyFrontendDecisions } from "@/lib/foundation/member-appeals";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { readSelfReviewCaller } from "@/lib/foundation/self-review-session";

/**
 * Moderation decisions that affect a member, as the member may see them:
 * what happened, the reason, the dates and the state of any appeal. Staff
 * notes, reporters and the staff involved are never included.
 */
export interface MemberDecision {
  decisionId: string;
  kind: "ban" | "suspension" | "warning" | "content_hidden";
  reason: string;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  appeal: {
    id: string;
    status: string;
    outcome: string | null;
    resolvedAt: string | null;
  } | null;
  appealable: boolean;
}

/** The signed-in member's decisions, or null when nobody is signed in. A
 * suspended or banned member can still read them (and appeal). */
export async function getMemberDecisions(): Promise<MemberDecision[] | null> {
  let caller;
  try {
    caller = await readSelfReviewCaller();
  } catch (error) {
    if (error instanceof FoundationSessionError && error.status === 401) return null;
    throw error;
  }
  return readMyFrontendDecisions(caller.api, caller.accountId);
}

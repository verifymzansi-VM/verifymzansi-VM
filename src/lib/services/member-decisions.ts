import "server-only";

import { readMyFrontendDecisions } from "@/lib/foundation/member-appeals";
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

export async function getMemberDecisions(userId: string): Promise<MemberDecision[]> {
  const { api, accountId } = await readSelfReviewCaller();
  if (accountId !== userId) throw new Error("Current account changed");
  return readMyFrontendDecisions(api, accountId);
}

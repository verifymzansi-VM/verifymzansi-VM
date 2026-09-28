import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

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

const APPEALABLE_CATEGORIES = new Set([
  "account_ban",
  "account_suspend",
  "account_warning",
  "content_removal",
]);

export async function getMemberDecisions(userId: string): Promise<MemberDecision[]> {
  const admin = createAdminClient();

  const [restrictionsResult, effectsResult] = await Promise.all([
    admin
      .from("account_restrictions")
      .select("decision_id, kind, reason, starts_at, ends_at, lifted_at")
      .eq("user_id", userId)
      .order("starts_at", { ascending: false })
      .limit(50),
    admin
      .from("content_effects")
      .select("decision_id, applied_at, reverted_at")
      .eq("owner_id", userId)
      .is("restriction_id", null)
      .order("applied_at", { ascending: false })
      .limit(50),
  ]);
  if (restrictionsResult.error || effectsResult.error) {
    throw new Error("Could not load decisions for this account");
  }

  const restrictions = restrictionsResult.data ?? [];
  const effects = effectsResult.data ?? [];
  const decisionIds = [
    ...new Set([...restrictions.map((r) => r.decision_id), ...effects.map((e) => e.decision_id)]),
  ];
  if (decisionIds.length === 0) return [];

  const [decisionsResult, appealsResult] = await Promise.all([
    admin
      .from("decision_records")
      .select("id, status, action_category, recommendation, rationale, created_at")
      .in("id", decisionIds),
    admin
      .from("appeal_cases")
      .select("id, decision_id, status, reviewer_rationale, resolved_at, created_at")
      .eq("appellant_id", userId)
      .in("decision_id", decisionIds)
      .order("created_at", { ascending: false }),
  ]);
  if (decisionsResult.error || appealsResult.error) {
    throw new Error("Could not load decisions for this account");
  }

  const decisions = new Map((decisionsResult.data ?? []).map((d) => [d.id, d] as const));
  const appealByDecision = new Map<string, NonNullable<MemberDecision["appeal"]>>();
  for (const a of appealsResult.data ?? []) {
    if (appealByDecision.has(a.decision_id)) continue;
    appealByDecision.set(a.decision_id, {
      id: a.id,
      status: a.status,
      outcome: a.resolved_at ? a.reviewer_rationale : null,
      resolvedAt: a.resolved_at,
    });
  }

  const appealable = (decisionId: string) => {
    const d = decisions.get(decisionId);
    return Boolean(
      d &&
      d.status === "approved" &&
      APPEALABLE_CATEGORIES.has(d.action_category) &&
      d.recommendation !== "lift" &&
      !appealByDecision.has(decisionId)
    );
  };

  const now = Date.now();
  const fromRestrictions: MemberDecision[] = restrictions.map((r) => ({
    decisionId: r.decision_id,
    kind: r.kind as MemberDecision["kind"],
    reason: r.reason,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    active:
      !r.lifted_at && (!r.ends_at || new Date(r.ends_at).getTime() > now) && r.kind !== "warning",
    appeal: appealByDecision.get(r.decision_id) ?? null,
    appealable: appealable(r.decision_id),
  }));

  const seen = new Set(fromRestrictions.map((d) => d.decisionId));
  const fromContent: MemberDecision[] = [];
  for (const e of effects) {
    if (seen.has(e.decision_id)) continue;
    seen.add(e.decision_id);
    const d = decisions.get(e.decision_id);
    fromContent.push({
      decisionId: e.decision_id,
      kind: "content_hidden",
      reason: d?.rationale ?? "Hidden after a moderation review",
      startsAt: e.applied_at,
      endsAt: null,
      active: !e.reverted_at,
      appeal: appealByDecision.get(e.decision_id) ?? null,
      appealable: appealable(e.decision_id),
    });
  }

  return [...fromRestrictions, ...fromContent].sort(
    (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()
  );
}

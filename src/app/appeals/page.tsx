import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMemberDecisions, type MemberDecision } from "@/lib/services/member-decisions";
import { formatSaLongDate } from "@/lib/utils/format";
import { createLogger } from "@/lib/utils/logger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const KIND_LABELS: Record<MemberDecision["kind"], string> = {
  ban: "Account banned",
  suspension: "Account suspended",
  warning: "Warning",
  content_hidden: "Content hidden",
};

const APPEAL_STATUS: Record<string, string> = {
  submitted: "Review requested",
  under_review: "Being reviewed",
  upheld: "Reviewed: the decision stands",
  dismissed: "Reviewed: the decision stands",
  overturned: "Reviewed: the decision was reversed",
  partially_overturned: "Reviewed: the decision was reduced",
};

export default async function AppealsPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) redirect("/login?returnUrl=%2Fappeals");

  const { submitted } = await searchParams;
  let decisions: MemberDecision[];
  try {
    decisions = await getMemberDecisions(user.id);
  } catch (err) {
    createLogger("AppealsPage").error("Could not load member decisions", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return (
      <p role="alert">
        Your decisions could not be loaded. Refresh to try again, or contact support.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-bold">Decisions and appeals</h1>
        <p className="text-sm text-muted-foreground">
          Moderation decisions on your account. If you think one is wrong, ask for a review by
          someone who was not involved. You can appeal each decision once.
        </p>
      </div>

      {submitted === "1" && (
        <p role="status" className="rounded-xl border bg-muted p-3 text-sm">
          Your appeal was sent. We will tell you the outcome by email and in your notifications.
        </p>
      )}

      {decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          There are no moderation decisions on your account.
        </p>
      ) : (
        <ul className="space-y-3">
          {decisions.map((d) => (
            <li
              key={`${d.decisionId}-${d.kind}`}
              id={d.appeal?.id}
              className="space-y-2 rounded-2xl border bg-card p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{KIND_LABELS[d.kind]}</p>
                {d.active ? (
                  <Badge variant="destructive">In effect</Badge>
                ) : (
                  <Badge variant="outline">Ended</Badge>
                )}
              </div>
              <p className="text-sm">{d.reason}</p>
              <p className="text-xs text-muted-foreground">
                From {formatSaLongDate(d.startsAt)}
                {d.endsAt && ` · ends ${formatSaLongDate(d.endsAt)}`}
              </p>
              {d.appeal ? (
                <div className="rounded-xl bg-muted p-3 text-sm">
                  <p className="font-medium">{APPEAL_STATUS[d.appeal.status] ?? d.appeal.status}</p>
                  {d.appeal.outcome && <p className="mt-1">{d.appeal.outcome}</p>}
                </div>
              ) : d.appealable ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/appeals/new?decision=${d.decisionId}`}>Ask for a review</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-muted-foreground">
        Need help?{" "}
        <Link href="/contact" className="underline">
          Contact support
        </Link>{" "}
        or make a{" "}
        <Link href="/dsar" className="underline">
          privacy request
        </Link>
        .
      </p>
    </>
  );
}

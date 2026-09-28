import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMemberDecisions } from "@/lib/services/member-decisions";
import { formatSaLongDate } from "@/lib/utils/format";
import { AppealForm } from "./appeal-form";

export default async function NewAppealPage({
  searchParams,
}: {
  searchParams: Promise<{ decision?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { decision } = await searchParams;
  if (!user || user.is_anonymous) {
    redirect(`/login?redirect=${encodeURIComponent(`/appeals/new?decision=${decision ?? ""}`)}`);
  }

  const decisions = await getMemberDecisions(user.id);
  const target = decisions.find((d) => d.decisionId === decision);
  if (!target || !target.appealable) {
    return (
      <>
        <h1 className="font-display text-2xl font-bold">Ask for a review</h1>
        <p className="text-sm">
          This decision cannot be appealed. It may already have an appeal, or it may not apply to
          your account.
        </p>
        <Link href="/appeals" className="text-sm underline">
          See your decisions and appeals
        </Link>
      </>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-bold">Ask for a review</h1>
        <p className="text-sm text-muted-foreground">
          Someone who was not involved in the decision will review it. Explain why you think it is
          wrong and include anything that helps, such as order numbers or dates. You can appeal each
          decision once.
        </p>
      </div>
      <div className="rounded-2xl border bg-card p-4 text-sm">
        <p className="font-medium">The decision</p>
        <p className="mt-1">{target.reason}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          From {formatSaLongDate(target.startsAt)}
          {target.endsAt && ` · ends ${formatSaLongDate(target.endsAt)}`}
        </p>
      </div>
      <AppealForm decisionId={target.decisionId} />
    </>
  );
}

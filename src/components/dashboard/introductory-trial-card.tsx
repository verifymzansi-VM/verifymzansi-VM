"use client";
import Link from "next/link";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSaLongDate } from "@/lib/utils/format";

type Claim = {
  id: string;
  duration_days: number;
  admin_granted: boolean;
  activated_at: string | null;
  expires_at: string | null;
  released_at: string | null;
  converted_at: string | null;
};
/** The dashboard page passes the member's free week as `foundationClaim`
 * (null when there is none to show); the card reads nothing itself. */
export function IntroductoryTrialCard({ foundationClaim }: { foundationClaim: Claim | null }) {
  const claim = foundationClaim;
  if (!claim || claim.converted_at || (!claim.activated_at && claim.released_at)) return null;
  return (
    <section
      className="rounded-2xl border border-brand-gold-300/70 bg-brand-gold-50/60 p-4 elev-xs dark:border-brand-gold-400/25 dark:bg-brand-gold-400/5 sm:p-5"
      aria-label="Free posts and trials"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gold-100 text-brand-gold-900 dark:bg-brand-gold-400/15 dark:text-brand-gold-200"
        >
          <Gift className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-display text-base font-semibold text-foreground">
            Your {claim.duration_days}
            -day {claim.admin_granted ? "free post" : "introductory trial"}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {claim.activated_at
              ? `Visible until ${claim.expires_at ? formatSaLongDate(claim.expires_at) : "soon"}. Then you have 3 days to reactivate it with a plan before it is deleted.`
              : claim.admin_granted
                ? `In review. Your ${claim.duration_days} free days start when approved.`
                : "In review. The trial starts when approved."}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <Button asChild variant="outline" className="h-11 rounded-full">
          <Link href="/billing">Choose a paid plan</Link>
        </Button>
        <Button asChild variant="ghost" className="h-11 rounded-full">
          <Link href="/dashboard/listings">View my posts and results</Link>
        </Button>
      </div>
    </section>
  );
}

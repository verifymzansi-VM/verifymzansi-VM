"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSaLongDate } from "@/lib/utils/format";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { getActiveFreePostUsage } from "@/lib/billing/free-posts";
import { hasCapability } from "@/lib/auth/roles";

type Claim = {
  id: string;
  duration_days: number;
  admin_granted: boolean;
  activated_at: string | null;
  expires_at: string | null;
  released_at: string | null;
  converted_at: string | null;
};
export function IntroductoryTrialCard() {
  const [eligible, setEligible] = useState(false);
  const [freePostsRemaining, setFreePostsRemaining] = useState(0);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [lengths, setLengths] = useState({ short: 7, long: 30 });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    async function load() {
      const client = createClient();
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user || hasCapability(user, "posting:bypass_limits")) return;
      const [usage, claims] = await Promise.all([
        getActiveFreePostUsage(client, user.id, "MZANSI_MARKET"),
        client
          .from("intro_trial_claims")
          .select("id,duration_days,admin_granted,activated_at,expires_at,released_at,converted_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (alive) {
        setEligible(usage.available);
        setFreePostsRemaining(usage.offer?.adminFreePostsRemaining ?? 0);
        setClaim(claims.data);
        setLengths({
          short: usage.offer?.shortDays ?? 7,
          long: usage.offer?.longDays ?? 30,
        });
      }
    }
    void load().catch(() => {
      /* An unavailable offer must never promise eligibility. */
    });
    return () => {
      alive = false;
    };
  }, []);
  async function update(action: "renew" | "choose_seven") {
    if (!claim) return;
    setBusy(true);
    try {
      const res = await fetch("/api/trials", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ claimId: claim.id, action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Unable to update trial");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!eligible && (!claim || claim.converted_at || (!claim.activated_at && claim.released_at)))
    return null;
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
          {eligible ? (
            <>
              <h2 className="font-display text-base font-semibold text-foreground">
                {freePostsRemaining > 0 ? "Your free posts" : "Your free launch offer"}
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                {freePostsRemaining > 0
                  ? `${freePostsRemaining} extra free posts left. Each runs 30 days from approval. No automatic charge.`
                  : `One free ${lengths.short}-day post or a ${lengths.long}-day launch trial. Events are always free. No automatic charge.`}
              </p>
            </>
          ) : (
            <>
              <h2 className="font-display text-base font-semibold text-foreground">
                Your{" "}
                {claim?.admin_granted
                  ? claim.duration_days
                  : claim?.duration_days === 7
                    ? lengths.short
                    : lengths.long}
                -day {claim?.admin_granted ? "free post" : "introductory trial"}
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                {claim?.activated_at
                  ? `Visible until ${claim.expires_at ? formatSaLongDate(claim.expires_at) : "soon"}. Your post stays saved.`
                  : claim?.admin_granted
                    ? `In review. Your ${claim.duration_days} free days start when approved.`
                    : "In review. The trial starts when approved."}
              </p>
            </>
          )}
        </div>
      </div>

      {eligible ? (
        <Button asChild variant="trust-verified" className="mt-4 h-11 w-full rounded-full">
          <Link href="/post/create">Choose a posting area</Link>
        </Button>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <Button
            disabled={busy}
            onClick={() => update("renew")}
            variant="trust-verified"
            className="h-11 rounded-full"
          >
            Renew using my paid plan
          </Button>
          {!claim?.admin_granted && !claim?.activated_at && claim?.duration_days === 30 && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => update("choose_seven")}
              className="h-11 rounded-full"
            >
              Switch pending post to {lengths.short} days
            </Button>
          )}
          <Button asChild variant="outline" className="h-11 rounded-full">
            <Link href="/billing">Choose a paid plan</Link>
          </Button>
          <Button asChild variant="ghost" className="h-11 rounded-full">
            <Link href="/dashboard/listings">View my posts and results</Link>
          </Button>
        </div>
      )}
      {message && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {message}
        </p>
      )}
    </section>
  );
}

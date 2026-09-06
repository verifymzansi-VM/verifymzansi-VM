"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { getActiveFreePostUsage } from "@/lib/billing/free-posts";
import { hasCapability } from "@/lib/auth/roles";

type Claim = {
  id: string;
  duration_days: number;
  activated_at: string | null;
  expires_at: string | null;
  released_at: string | null;
  converted_at: string | null;
};
export function IntroductoryTrialCard() {
  const [eligible, setEligible] = useState(false);
  const [claim, setClaim] = useState<Claim | null>(null);
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
          .select("id,duration_days,activated_at,expires_at,released_at,converted_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (alive) {
        setEligible(usage.offer?.eligible ?? false);
        setClaim(claims.data);
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
    <section className="rounded-xl border bg-card p-5 space-y-3" aria-label="Introductory trial">
      {eligible ? (
        <>
          <h2 className="font-semibold">Your Free Launch Offer</h2>
          <p className="text-sm text-muted-foreground">
            Choose one free 7-day post or a limited 30-day launch trial across Mzansi Market, Mzansi
            Business and Tourism &amp; Events. Select your offer while posting. No automatic charge.
          </p>
          <Button asChild>
            <Link href="/post/create">Choose a posting area</Link>
          </Button>
        </>
      ) : (
        <>
          <h2 className="font-semibold">Your {claim?.duration_days}-day introductory trial</h2>
          <p className="text-sm">
            {claim?.activated_at
              ? `Trial visibility ends ${new Date(claim.expires_at!).toLocaleString("en-ZA")}. Your content stays saved for renewal.`
              : "Your post is awaiting review. The trial starts only when approved; 30-day capacity is checked then."}
          </p>
          <div className="flex flex-wrap gap-2">
            {!claim?.activated_at && claim?.duration_days === 30 && (
              <Button variant="outline" disabled={busy} onClick={() => update("choose_seven")}>
                Switch pending post to 7 days
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/billing">Choose a paid plan</Link>
            </Button>
            <Button disabled={busy} onClick={() => update("renew")}>
              Renew using my paid plan
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/listings">View my posts and results</Link>
            </Button>
          </div>
        </>
      )}
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </section>
  );
}

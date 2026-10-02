"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CalendarClock, Loader2, LockKeyhole, ReceiptText } from "lucide-react";
import { BrandLogo } from "@/components/shared/brand-logo";
import { Button } from "@/components/ui/button";
import { formatSaLongDate } from "@/lib/utils/format";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { getFriendlyCheckoutError } from "@/lib/billing/checkout-copy";
import { formatPlanPrice } from "@/lib/constants/pricing";

export interface CheckoutSummary {
  planId: string;
  name: string;
  areaLabel: string;
  priceCents: number;
  durationDays: number;
  durationLabel: string;
  slotCapacity: number;
  monthlyActivationLimit: number | null;
  /** Named administrators included (multi-listing plans only). */
  administrators?: number | null;
}

interface PendingPayment {
  id: string;
  checkoutUrl?: string | null;
  statusUrl?: string | null;
  canCancel?: boolean;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

/** Explicit confirmation before Ozow: price, dates, slots, renewal and expiry. */
export function CheckoutConfirm({ summary }: { summary: CheckoutSummary | null }) {
  const [state, setState] = useState<"idle" | "submitting" | "redirecting">("idle");
  const [error, setError] = useState<string | null>(
    summary ? null : "This plan is not available. Please choose a plan from the pricing page."
  );
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const pending = useRef(false);

  // Coming back from Ozow with the browser Back button can restore this page
  // from the back/forward cache with the button stuck on "Redirecting…".
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      pending.current = false;
      setState("idle");
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  // Dates use the deterministic SA formatter so server and browser render the same text.
  const [start] = useState(() => new Date());
  const expiry = summary ? new Date(start.getTime() + summary.durationDays * 86_400_000) : null;

  async function pay() {
    if (!summary || pending.current) return;
    pending.current = true;
    setState("submitting");
    setError(null);
    setNeedsSignIn(false);
    try {
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ planId: summary.planId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.pendingPayment && typeof data.pendingPayment.id === "string") {
          setPendingPayment(data.pendingPayment as PendingPayment);
        }
        setError(getFriendlyCheckoutError(res.status, data.error, summary.name));
        setNeedsSignIn(res.status === 401);
        setState("idle");
        pending.current = false;
        return;
      }
      if (typeof data.checkoutUrl === "string") {
        setState("redirecting");
        window.location.assign(data.checkoutUrl);
        return;
      }
      setError("Secure checkout did not return a redirect URL.");
    } catch {
      setError(getFriendlyCheckoutError(undefined, null, summary.name));
    }
    setState("idle");
    pending.current = false;
  }

  async function cancelPending() {
    if (!pendingPayment) return;
    setCancelling(true);
    try {
      const res = await fetch("/api/billing/cancel-pending", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ paymentId: pendingPayment.id }),
      });
      if (res.ok) {
        setPendingPayment(null);
        setError(null);
      } else {
        setError("The pending payment could not be cancelled. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  const errorBlock = error ? (
    <p
      role="alert"
      className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
    >
      {error}
      {needsSignIn && summary ? (
        <>
          {" "}
          <Link
            href={`/login?returnUrl=${encodeURIComponent(
              `/billing/checkout?plan=${summary.planId}`
            )}`}
            className="font-semibold underline underline-offset-2"
          >
            Sign in
          </Link>
        </>
      ) : null}
    </p>
  ) : null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/60 bg-card/80">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Link
            href="/"
            aria-label="VerifyMzansi home"
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandLogo size="sm" />
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground sm:text-sm">
            <LockKeyhole
              aria-hidden="true"
              className="h-4 w-4 text-brand-green-700 dark:text-brand-green-300"
            />
            Secure checkout
          </span>
        </div>
      </header>

      <main
        id="main-content"
        className="bg-hero-mesh flex flex-1 scroll-mt-24 justify-center px-4 py-6 sm:items-center sm:py-8"
      >
        {summary && expiry ? (
          // Desktop: price and pay on the left, the plan terms on the right, so the whole
          // review fits one screen. Phones stack them with the pay button pinned below.
          <div className="grid w-full max-w-md rounded-3xl border border-border/70 bg-card elev-md lg:max-w-4xl lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:grid-rows-[auto_1fr]">
            <div className="p-5 pb-0 sm:p-7 sm:pb-0 lg:col-start-1 lg:row-start-1">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground/80">
                <ReceiptText aria-hidden="true" className="h-3.5 w-3.5" />
                Review before you pay
              </p>
              <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-foreground">
                Confirm your plan
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{summary.name}</p>
              <div className="mt-5 flex items-end justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3.5">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Total today</p>
                  <p className="font-display text-4xl font-extrabold leading-none tracking-tight text-foreground">
                    {formatPlanPrice(summary.priceCents)}
                  </p>
                </div>
                <p className="pb-0.5 text-right text-xs font-medium text-muted-foreground">
                  Once-off, in rand
                </p>
              </div>
            </div>

            <section
              aria-labelledby="checkout-details-title"
              className="px-5 pt-4 sm:px-7 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:rounded-r-3xl lg:border-l lg:border-border/60 lg:bg-muted/25 lg:py-7"
            >
              <h2
                id="checkout-details-title"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Plan details
              </h2>
              <dl className="mt-2 divide-y divide-border/60">
                <SummaryRow label="Section" value={summary.areaLabel} />
                <SummaryRow label="Duration" value={summary.durationLabel} />
                <SummaryRow label="Starts" value={`${formatSaLongDate(start)} (on payment)`} />
                <SummaryRow label="Expires" value={formatSaLongDate(expiry)} />
                <SummaryRow
                  label="Active posting slots"
                  value={`${summary.slotCapacity} at a time, reusable when a post sells or ends`}
                />
                {summary.monthlyActivationLimit ? (
                  <SummaryRow
                    label="Fair-use activations"
                    value={`Up to ${summary.monthlyActivationLimit} per 30 days`}
                  />
                ) : null}
                {summary.administrators ? (
                  <SummaryRow
                    label="Administrators"
                    value={`${summary.administrators} named: you plus one more, added from My posts`}
                  />
                ) : null}
                <SummaryRow label="Renewal" value="Does not renew automatically" />
                <SummaryRow
                  label="After expiry"
                  value="Posts become inactive and stay saved in your dashboard for reactivation"
                />
              </dl>
            </section>

            <div className="sticky bottom-0 flex flex-col gap-3 rounded-b-3xl border-t border-border/60 bg-card/95 px-5 pb-4 pt-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-7 sm:pb-7 sm:pt-5 sm:backdrop-blur-none lg:col-start-1 lg:row-start-2 lg:pt-6">
              {errorBlock}
              {pendingPayment ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {pendingPayment.checkoutUrl ? (
                    <Button asChild variant="outline" className="h-11 flex-1 rounded-full">
                      <a href={pendingPayment.checkoutUrl}>Continue payment</a>
                    </Button>
                  ) : null}
                  {pendingPayment.statusUrl ? (
                    <Button asChild variant="ghost" className="h-11 flex-1 rounded-full">
                      <Link href={pendingPayment.statusUrl}>Check status</Link>
                    </Button>
                  ) : null}
                  {pendingPayment.canCancel ? (
                    <Button
                      variant="outline"
                      className="h-11 flex-1 rounded-full"
                      disabled={cancelling}
                      onClick={cancelPending}
                    >
                      {cancelling ? "Cancelling…" : "Cancel pending payment"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-col gap-1 sm:gap-2">
                <Button
                  variant="trust-verified"
                  size="lg"
                  className="h-12 rounded-full"
                  disabled={state !== "idle"}
                  onClick={pay}
                >
                  {state === "idle" ? (
                    <>
                      <LockKeyhole aria-hidden="true" className="h-4 w-4" />
                      {`Pay ${formatPlanPrice(summary.priceCents)} securely`}
                    </>
                  ) : (
                    <>
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                      {state === "redirecting"
                        ? "Redirecting to Ozow…"
                        : "Opening secure checkout…"}
                    </>
                  )}
                </Button>
                <Button asChild variant="ghost" className="h-11 rounded-full">
                  <Link href="/pricing">Back to pricing</Link>
                </Button>
              </div>
              <ul className="hidden space-y-2 text-xs leading-5 text-muted-foreground sm:block">
                <li className="flex gap-2.5">
                  <LockKeyhole aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  You&apos;ll pay on Ozow&apos;s secure page.
                </li>
                <li className="flex gap-2.5">
                  <CalendarClock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  Posts go live once payment is confirmed and they pass review.
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex w-full max-w-md flex-col gap-4 rounded-3xl border border-border/70 bg-card p-5 elev-md sm:p-7">
            <div className="text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <AlertCircle aria-hidden="true" className="h-7 w-7" />
              </span>
              <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-foreground">
                Confirm your plan
              </h1>
            </div>
            {errorBlock}
            <Button asChild variant="ghost" className="h-11 w-full rounded-full">
              <Link href="/pricing">Back to pricing</Link>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

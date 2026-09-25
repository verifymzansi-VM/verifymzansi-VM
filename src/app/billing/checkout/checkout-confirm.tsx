"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
}

interface PendingPayment {
  id: string;
  checkoutUrl?: string | null;
  statusUrl?: string | null;
  canCancel?: boolean;
}

const dateFormat = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Africa/Johannesburg",
});

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
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
  const pending = useRef(false);
  const start = new Date();
  const expiry = summary ? new Date(start.getTime() + summary.durationDays * 86_400_000) : null;

  async function pay() {
    if (!summary || pending.current) return;
    pending.current = true;
    setState("submitting");
    setError(null);
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

  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-10 scroll-mt-24"
    >
      <div className="w-full max-w-md rounded-3xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          {error && !summary ? (
            <AlertCircle aria-hidden="true" className="h-6 w-6 text-destructive" />
          ) : (
            <CreditCard aria-hidden="true" className="h-6 w-6 text-brand-green" />
          )}
        </div>
        <h1 className="text-center font-display text-xl font-bold">Confirm your plan</h1>

        {summary && expiry ? (
          <>
            <p className="mt-1 text-center text-sm text-muted-foreground">{summary.name}</p>
            <p className="mt-4 text-center font-display text-4xl font-bold">
              {formatPlanPrice(summary.priceCents)}
            </p>
            <dl className="mt-5 divide-y divide-border/60 border-y border-border/60">
              <SummaryRow label="Section" value={summary.areaLabel} />
              <SummaryRow label="Duration" value={summary.durationLabel} />
              <SummaryRow label="Starts" value={`${dateFormat.format(start)} (on payment)`} />
              <SummaryRow label="Expires" value={dateFormat.format(expiry)} />
              <SummaryRow
                label="Active posting slots"
                value={`${summary.slotCapacity} at a time — reusable when a post sells or ends`}
              />
              {summary.monthlyActivationLimit ? (
                <SummaryRow
                  label="Fair-use activations"
                  value={`Up to ${summary.monthlyActivationLimit} per 30 days`}
                />
              ) : null}
              <SummaryRow label="Renewal" value="Does not renew automatically" />
              <SummaryRow
                label="After expiry"
                value="Posts become inactive and stay saved in your dashboard for reactivation"
              />
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Visibility starts only after Ozow confirms your payment. Paid posts are still
              moderated.
            </p>
          </>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 text-center text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {pendingPayment ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {pendingPayment.checkoutUrl ? (
              <Button asChild variant="outline" className="h-11 rounded-full">
                <a href={pendingPayment.checkoutUrl}>Continue payment</a>
              </Button>
            ) : null}
            {pendingPayment.statusUrl ? (
              <Button asChild variant="ghost" className="h-11 rounded-full">
                <Link href={pendingPayment.statusUrl}>Check status</Link>
              </Button>
            ) : null}
            {pendingPayment.canCancel ? (
              <Button
                variant="outline"
                className="h-11 rounded-full"
                disabled={cancelling}
                onClick={cancelPending}
              >
                {cancelling ? "Cancelling…" : "Cancel pending payment"}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-2">
          {summary ? (
            <Button
              className="h-11 rounded-full font-semibold"
              disabled={state !== "idle"}
              onClick={pay}
            >
              {state === "idle" ? (
                `Pay ${formatPlanPrice(summary.priceCents)} securely`
              ) : (
                <>
                  <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
                  {state === "redirecting" ? "Redirecting to Ozow…" : "Opening secure checkout…"}
                </>
              )}
            </Button>
          ) : null}
          <Button asChild variant="outline" className="h-11 rounded-full font-semibold">
            <Link href="/pricing">Back to pricing</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

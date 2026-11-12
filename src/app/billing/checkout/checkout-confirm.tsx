"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CalendarClock,
  Loader2,
  LockKeyhole,
  Minus,
  Plus,
  ReceiptText,
} from "lucide-react";
import { BrandLogo } from "@/components/shared/brand-logo";
import { Button } from "@/components/ui/button";
import { formatSaLongDate } from "@/lib/utils/format";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { getFriendlyCheckoutError } from "@/lib/billing/checkout-copy";
import { formatDurationDays, formatPlanPrice } from "@/lib/constants/pricing";
import {
  BILLING_EMAIL,
  COOLING_OFF_CONSENT,
  ONLINE_ORDER_LIMIT_CENTS,
  slotOrderTotalCents,
  slotsAvailable,
  type SlotCheckoutStatus,
  type SlotCheckoutTerm,
} from "@/lib/billing/slot-checkout";
import { cn } from "@/lib/utils";

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
  expiryNotice?: string;
  /** Individual slots: every term on sale (the linked one is chosen first). */
  slotTerms?: SlotCheckoutTerm[];
  /** The member's Individual slots; null when they could not be read. */
  slotStatus?: SlotCheckoutStatus | null;
}

/** Most slots one order offers; the database applies the person's limit. */
const MAX_SLOTS_PER_ORDER = 25;
/** Without the member's count the page offers the standard limit. */
const STANDARD_SLOT_LIMIT = 4;

type SlotBlock = "id_review" | "limit" | "invoice";

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

/** Why an Individual slot cannot be bought online now, and where to go. */
function SlotBlockNotice({
  block,
  status,
}: {
  block: SlotBlock;
  status: SlotCheckoutStatus | null;
}) {
  return (
    <div
      role="status"
      data-testid={`slot-block-${block}`}
      className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5 text-sm leading-6 text-foreground/80"
    >
      {block === "id_review" ? (
        <>
          <p>
            Your ID review must be accepted before you buy a slot, so you never pay for days you
            cannot use.
          </p>
          <Button asChild variant="outline" className="h-11 rounded-full">
            <Link href="/verification">Go to my ID review</Link>
          </Button>
        </>
      ) : block === "limit" ? (
        <>
          <p>
            {`You can hold ${status?.limit ?? STANDARD_SLOT_LIMIT} Individual slots at a time. A slot frees up when it ends.`}
          </p>
          <Button asChild variant="outline" className="h-11 rounded-full">
            <Link href="/dashboard/slots">My slots</Link>
          </Button>
        </>
      ) : (
        <p>
          Orders above R10,000 are paid by invoice.{" "}
          <a
            href={`mailto:${BILLING_EMAIL}?subject=Invoice%20for%20slots`}
            className="font-medium text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300"
          >
            Ask for an invoice
          </a>
        </p>
      )}
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
  // Individual slots: the term (the linked one first), the number of slots and
  // the cooling-off consent. The total is slot price x slots.
  const slotTerms = summary?.slotTerms?.length ? summary.slotTerms : null;
  const [termId, setTermId] = useState(summary?.planId ?? "");
  const term = slotTerms
    ? (slotTerms.find((entry) => entry.planId === termId) ?? slotTerms[0])
    : null;
  const available = slotsAvailable(summary?.slotStatus);
  const maxSlots = Math.max(1, Math.min(MAX_SLOTS_PER_ORDER, available ?? STANDARD_SLOT_LIMIT));
  const [slots, setSlots] = useState(1);
  const [consent, setConsent] = useState(false);
  const totalCents = term ? slotOrderTotalCents(term, slots) : (summary?.priceCents ?? 0);
  const durationDays = term?.durationDays ?? summary?.durationDays ?? 0;
  const slotBlock: SlotBlock | null = !term
    ? null
    : summary?.slotStatus?.verified === false
      ? "id_review"
      : available === 0
        ? "limit"
        : totalCents > ONLINE_ORDER_LIMIT_CENTS
          ? "invoice"
          : null;
  const checkoutHref = `/billing/checkout?plan=${term?.planId ?? summary?.planId ?? ""}`;

  // Dates use the deterministic SA formatter so server and browser render the same text.
  const [start] = useState(() => new Date());
  const expiry = summary ? new Date(start.getTime() + durationDays * 86_400_000) : null;

  async function pay() {
    if (!summary || pending.current || slotBlock || (term && !consent)) return;
    pending.current = true;
    setState("submitting");
    setError(null);
    setNeedsSignIn(false);
    try {
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(
          term
            ? {
                planId: term.planId,
                slots,
                expectedTotalCents: totalCents,
                coolingOffConsent: consent,
              }
            : { planId: summary.planId }
        ),
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
            href={`/login?returnUrl=${encodeURIComponent(checkoutHref)}`}
            className="font-semibold underline underline-offset-2"
          >
            Sign in
          </Link>
        </>
      ) : null}
    </p>
  ) : null;

  return (
    <div className="flex min-h-screen flex-col">
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
              className="h-4 w-4 text-brand-green-700 dark:text-brand-gold-300"
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
              <p className="mt-1 text-sm text-muted-foreground">{term?.label ?? summary.name}</p>
              <div className="mt-5 flex items-end justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3.5">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Total today</p>
                  <p
                    data-testid="checkout-total"
                    className="font-display text-4xl font-extrabold leading-none tracking-tight text-foreground"
                  >
                    {formatPlanPrice(totalCents)}
                  </p>
                </div>
                <p className="pb-0.5 text-right text-xs font-medium text-muted-foreground">
                  {term && slots > 1
                    ? `${formatPlanPrice(term.priceCents)} × ${slots} slots`
                    : "Once-off, in rand"}
                </p>
              </div>
              {slotTerms && term ? (
                <div className="mt-4 space-y-4">
                  <fieldset>
                    <legend className="text-xs font-semibold text-muted-foreground">Days</legend>
                    <div className="mt-2 grid grid-cols-3 gap-1 rounded-full border border-border/70 bg-card p-1">
                      {slotTerms.map((entry) => {
                        const active = entry.planId === term.planId;
                        return (
                          <label
                            key={entry.planId}
                            className={cn(
                              "flex h-11 cursor-pointer items-center justify-center rounded-full text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-ring",
                              active
                                ? "bg-muted text-foreground shadow-sm ring-1 ring-border dark:bg-warm-800"
                                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            )}
                          >
                            <input
                              type="radio"
                              name="slot-term"
                              value={entry.planId}
                              checked={active}
                              onChange={() => setTermId(entry.planId)}
                              className="sr-only"
                            />
                            {formatDurationDays(entry.durationDays)}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  <div className="flex items-center justify-between gap-3">
                    <p
                      id="slot-count-label"
                      className="text-xs font-semibold text-muted-foreground"
                    >
                      Slots
                    </p>
                    <div
                      role="group"
                      aria-labelledby="slot-count-label"
                      className="flex items-center gap-1 rounded-full border border-border/70 bg-card p-1"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 rounded-full"
                        aria-label="One slot fewer"
                        disabled={slots <= 1}
                        onClick={() => setSlots((value) => Math.max(1, value - 1))}
                      >
                        <Minus aria-hidden="true" className="h-4 w-4" />
                      </Button>
                      <output
                        aria-live="polite"
                        data-testid="checkout-slots"
                        className="w-8 text-center font-display text-lg font-bold"
                      >
                        {slots}
                      </output>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 rounded-full"
                        aria-label="One slot more"
                        disabled={slots >= maxSlots}
                        onClick={() => setSlots((value) => Math.min(maxSlots, value + 1))}
                      >
                        <Plus aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <section
              aria-labelledby="checkout-details-title"
              className="px-5 pt-4 sm:px-7 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:rounded-r-3xl lg:border-l lg:border-border/60 lg:bg-muted/25 lg:py-7"
            >
              <h2
                id="checkout-details-title"
                className="text-xs font-semibold text-muted-foreground"
              >
                Plan details
              </h2>
              <dl className="mt-2 divide-y divide-border/60">
                <SummaryRow label="Section" value={summary.areaLabel} />
                <SummaryRow
                  label="Duration"
                  value={term ? formatDurationDays(term.durationDays) : summary.durationLabel}
                />
                <SummaryRow label="Starts" value={`${formatSaLongDate(start)} (on payment)`} />
                <SummaryRow label="Expires" value={formatSaLongDate(expiry)} />
                {term ? (
                  <SummaryRow
                    label="Each slot"
                    value="Holds one post at a time, reusable once its post is deleted"
                  />
                ) : (
                  <SummaryRow
                    label="Active posting slots"
                    value={`${summary.slotCapacity} at a time, reusable once its post is deleted`}
                  />
                )}
                {summary.monthlyActivationLimit ? (
                  <SummaryRow
                    label={term ? "Fair use" : "Fair-use activations"}
                    value={
                      term
                        ? `Up to ${summary.monthlyActivationLimit} posts going live per slot per 30 days`
                        : `Up to ${summary.monthlyActivationLimit} per 30 days`
                    }
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
                  value={
                    summary.expiryNotice ??
                    "Posts become inactive and stay saved in your dashboard for reactivation"
                  }
                />
              </dl>
            </section>

            <div className="sticky bottom-0 flex flex-col gap-3 rounded-b-3xl border-t border-border/60 bg-card/95 px-5 pb-4 pt-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-7 sm:pb-7 sm:pt-5 sm:backdrop-blur-none lg:col-start-1 lg:row-start-2 lg:pt-6">
              {errorBlock}
              {slotBlock ? (
                <SlotBlockNotice block={slotBlock} status={summary.slotStatus ?? null} />
              ) : term ? (
                <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5">
                  <input
                    type="checkbox"
                    id="cooling-off-consent"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-brand-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:accent-brand-green-400"
                  />
                  <label
                    htmlFor="cooling-off-consent"
                    className="cursor-pointer text-sm leading-6 text-foreground/80"
                  >
                    {COOLING_OFF_CONSENT}{" "}
                    <Link
                      href="/terms#refunds"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300"
                    >
                      Refunds
                    </Link>
                  </label>
                </div>
              ) : null}
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
                  disabled={state !== "idle" || slotBlock !== null || (term !== null && !consent)}
                  onClick={pay}
                >
                  {state === "idle" ? (
                    <>
                      <LockKeyhole aria-hidden="true" className="h-4 w-4" />
                      {`Pay ${formatPlanPrice(totalCents)} securely`}
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

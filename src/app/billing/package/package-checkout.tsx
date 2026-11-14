"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, LockKeyhole, Minus, Plus, Users } from "lucide-react";
import { BrandLogo } from "@/components/shared/brand-logo";
import { Button } from "@/components/ui/button";
import { formatSaLongDate } from "@/lib/utils/format";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { getFriendlyCheckoutError } from "@/lib/billing/checkout-copy";
import { formatDurationDays, formatPlanPrice } from "@/lib/constants/pricing";
import { BILLING_EMAIL } from "@/lib/billing/slot-checkout";
import {
  PACKAGE_ADD_SLOTS_MIN_DAYS_LEFT,
  PACKAGE_COOLING_OFF_CONSENT,
  PACKAGE_MAX_SLOTS,
  PACKAGE_MIN_SLOTS,
  PACKAGE_POSTS_PER_SLOT_PER_30_DAYS,
  PACKAGE_QUICK_SIZES,
  PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS,
  isPackageTerm,
  packageOnlineMaxSlots,
  packageQuote,
  packageTeamSize,
  parseSlotCount,
  type PackageTerm,
} from "@/lib/billing/slot-packages";
import { cn } from "@/lib/utils";

/** One package term on sale (api.get_slot_package_offer). */
export interface PackageCheckoutTerm {
  planId: string;
  days: PackageTerm;
}

/** Why the member cannot buy a package now. */
export type PackageCheckoutBlock = "id_review" | "has_package";

interface PendingPayment {
  id: string;
  checkoutUrl?: string | null;
  statusUrl?: string | null;
  canCancel?: boolean;
  slots?: number;
  amountCents?: number;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * "Choose your package" (roadmap P4a; the owner's approved draft p4-01/p4-02):
 * the member types the number of slots (5 to 100 online, shortcuts 5, 10, 25,
 * 50 and 100) and picks 30, 90 or 180 days; the total is R100 per slot per 30
 * days. Above R10,000 (or 100 slots) the package is bought by invoice. The
 * database applies every rule again; this page is shown only while packages
 * are on sale.
 */
export function PackageCheckout({
  terms,
  initialSlots = 25,
  initialDays = 30,
  block = null,
}: {
  terms: PackageCheckoutTerm[];
  initialSlots?: number;
  initialDays?: number;
  block?: PackageCheckoutBlock | null;
}) {
  const ids = useId();
  const firstTerm = terms.find((term) => term.days === initialDays) ?? terms[0];
  const [days, setDays] = useState<PackageTerm>(firstTerm?.days ?? 30);
  const term = terms.find((entry) => entry.days === days) ?? firstTerm;
  const [text, setText] = useState(String(initialSlots));
  const slots = parseSlotCount(text);
  const quote = packageQuote(slots, days);
  const totalCents = quote.kind === "online" || quote.kind === "invoice" ? quote.totalCents : null;
  const onlineMax = packageOnlineMaxSlots(days);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "submitting" | "redirecting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const pending = useRef(false);

  // Back from Ozow through the back/forward cache: never stuck on "Redirecting…".
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      pending.current = false;
      setState("idle");
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const [start] = useState(() => new Date());
  const ends = new Date(start.getTime() + days * 86_400_000);
  const step = (by: number) => {
    const next = Math.min(PACKAGE_MAX_SLOTS, Math.max(PACKAGE_MIN_SLOTS, (slots ?? 0) + by));
    setText(String(next));
  };
  const canPay =
    !block && quote.kind === "online" && consent && state === "idle" && term !== undefined;
  const checkoutHref = `/billing/package?slots=${slots ?? PACKAGE_MIN_SLOTS}&days=${days}`;

  async function pay() {
    if (!canPay || pending.current || !term || totalCents === null || slots === null) return;
    pending.current = true;
    setState("submitting");
    setError(null);
    setNeedsSignIn(false);
    try {
      const res = await fetch("/api/billing/package-checkout", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          planId: term.planId,
          slots,
          expectedTotalCents: totalCents,
          coolingOffConsent: consent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.pendingPayment && typeof data.pendingPayment.id === "string")
          setPendingPayment(data.pendingPayment as PendingPayment);
        setError(getFriendlyCheckoutError(res.status, data.error, "your package"));
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
      setError(getFriendlyCheckoutError(undefined, null, "your package"));
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
      } else setError("The pending payment could not be cancelled. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  const boxMessage =
    quote.kind === "too_small" || quote.kind === "invalid"
      ? `Packages start at ${PACKAGE_MIN_SLOTS} slots. For 1-4, use Individual slots (R69).`
      : quote.kind === "too_large"
        ? `A package holds at most ${PACKAGE_MAX_SLOTS} slots for now.`
        : `Up to ${onlineMax} slots for ${formatDurationDays(days)} can be paid online.`;

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
        <div className="grid w-full max-w-md rounded-3xl border border-border/70 bg-card elev-md lg:max-w-4xl lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:grid-rows-[auto_1fr]">
          <div className="p-5 pb-0 sm:p-7 sm:pb-0 lg:col-start-1 lg:row-start-1">
            <p className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground/80">
              Multi-listing
            </p>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-foreground">
              Choose your package
            </h1>
            <div className="mt-5 flex items-end justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3.5">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Total</p>
                <p
                  data-testid="package-total"
                  className="font-display text-4xl font-extrabold leading-none tracking-tight text-foreground"
                >
                  {totalCents === null ? "—" : formatPlanPrice(totalCents)}
                </p>
              </div>
              <p className="pb-0.5 text-right text-xs font-medium text-muted-foreground">
                {`${formatPlanPrice(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)} per slot per 30 days`}
              </p>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor={`${ids}-slots`}
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Slots
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 shrink-0 rounded-full"
                    aria-label="One slot fewer"
                    disabled={(slots ?? 0) <= PACKAGE_MIN_SLOTS}
                    onClick={() => step(-1)}
                  >
                    <Minus aria-hidden="true" className="h-4 w-4" />
                  </Button>
                  <input
                    id={`${ids}-slots`}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    size={4}
                    value={text}
                    onChange={(event) => {
                      setText(event.target.value.replace(/[^0-9]/g, "").slice(0, 4));
                      setConsent(false);
                    }}
                    aria-describedby={`${ids}-slots-help`}
                    aria-invalid={quote.kind !== "online" && quote.kind !== "invoice"}
                    data-testid="package-slots"
                    className="h-12 w-0 min-w-0 flex-1 rounded-2xl border border-input bg-card px-4 text-center font-display text-2xl font-bold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 shrink-0 rounded-full"
                    aria-label="One slot more"
                    disabled={(slots ?? 0) >= PACKAGE_MAX_SLOTS}
                    onClick={() => step(1)}
                  >
                    <Plus aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1.5" aria-label="Quick choices">
                  {PACKAGE_QUICK_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        setText(String(size));
                        setConsent(false);
                      }}
                      aria-pressed={slots === size}
                      className={cn(
                        "h-11 rounded-full border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        slots === size
                          ? "border-brand-green-700 bg-brand-green-700 text-white dark:border-brand-green-400 dark:bg-brand-green-600"
                          : "border-border/80 bg-card text-foreground hover:bg-muted/60"
                      )}
                    >
                      {size}
                    </button>
                  ))}
                </div>
                <p
                  id={`${ids}-slots-help`}
                  aria-live="polite"
                  data-testid="package-slots-help"
                  className={cn(
                    "mt-2 text-xs leading-5",
                    quote.kind === "online" || quote.kind === "invoice"
                      ? "text-muted-foreground"
                      : "font-medium text-destructive"
                  )}
                >
                  {boxMessage}
                </p>
              </div>

              <fieldset>
                <legend className="text-xs font-semibold text-muted-foreground">Days</legend>
                <div className="mt-2 grid grid-cols-3 gap-1 rounded-full border border-border/70 bg-card p-1">
                  {terms.map((entry) => {
                    const active = entry.days === days;
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
                          name={`${ids}-term`}
                          value={entry.days}
                          checked={active}
                          onChange={() => {
                            if (isPackageTerm(entry.days)) setDays(entry.days);
                            setConsent(false);
                          }}
                          className="sr-only"
                        />
                        {formatDurationDays(entry.days)}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          </div>

          <section
            aria-labelledby={`${ids}-details`}
            className="px-5 pt-4 sm:px-7 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:rounded-r-3xl lg:border-l lg:border-border/60 lg:bg-muted/25 lg:py-7"
          >
            <h2 id={`${ids}-details`} className="font-display text-base font-bold text-foreground">
              Package details
            </h2>
            <dl className="mt-1 divide-y divide-border/60">
              <DetailRow label="Starts">On payment</DetailRow>
              <DetailRow label="Ends">
                {`${formatDurationDays(days)} later, all slots together (${formatSaLongDate(ends)})`}
              </DetailRow>
              <DetailRow label="Team">
                <span className="inline-flex items-center gap-1.5">
                  <Users
                    aria-hidden="true"
                    className="h-4 w-4 text-brand-green-700 dark:text-brand-gold-300"
                  />
                  {`You + ${packageTeamSize(slots ?? PACKAGE_MIN_SLOTS) - 1} ${packageTeamSize(slots ?? PACKAGE_MIN_SLOTS) === 2 ? "person" : "people"}`}
                </span>
              </DetailRow>
              <DetailRow label="Fair use">
                {`Up to ${PACKAGE_POSTS_PER_SLOT_PER_30_DAYS} posts going live per slot per 30 days`}
              </DetailRow>
              <DetailRow label="Add slots later">
                {`Yes, while ${PACKAGE_ADD_SLOTS_MIN_DAYS_LEFT} or more days are left`}
              </DetailRow>
              <DetailRow label="Renewal">Does not renew automatically</DetailRow>
            </dl>
          </section>

          <div className="sticky bottom-0 flex flex-col gap-3 rounded-b-3xl border-t border-border/60 bg-card/95 px-5 pb-4 pt-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-7 sm:pb-7 sm:pt-5 sm:backdrop-blur-none lg:col-start-1 lg:row-start-2 lg:pt-6">
            {error ? (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
              >
                {error}
                {needsSignIn ? (
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
            ) : null}
            {block ? (
              <div
                role="status"
                data-testid={`package-block-${block}`}
                className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5 text-sm leading-6 text-foreground/80"
              >
                {block === "id_review" ? (
                  <>
                    <p>
                      Your ID review must be accepted before you buy a package, so you never pay for
                      days you cannot use.
                    </p>
                    <Button asChild variant="outline" className="h-11 rounded-full">
                      <Link href="/verification">Go to my ID review</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <p>You already have a Multi-listing package.</p>
                    <Button asChild variant="outline" className="h-11 rounded-full">
                      <Link href="/dashboard/slots">My slots</Link>
                    </Button>
                  </>
                )}
              </div>
            ) : quote.kind === "invoice" ? (
              <div
                role="status"
                data-testid="package-invoice"
                className="rounded-xl border border-border/80 bg-muted/40 p-3.5 text-sm leading-6 text-foreground/80"
              >
                <p>
                  {`Above ${formatPlanPrice(1_000_000)} (or ${onlineMax} slots for ${formatDurationDays(days)}) is paid by invoice, at the same price.`}{" "}
                  <a
                    href={`mailto:${BILLING_EMAIL}?subject=Invoice%20for%20a%20Multi-listing%20package`}
                    className="font-medium text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300"
                  >
                    Ask for an invoice
                  </a>
                </p>
              </div>
            ) : quote.kind === "online" ? (
              <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5">
                <input
                  type="checkbox"
                  id={`${ids}-consent`}
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-brand-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:accent-brand-green-400"
                />
                <label
                  htmlFor={`${ids}-consent`}
                  className="cursor-pointer text-sm leading-6 text-foreground/80"
                >
                  {PACKAGE_COOLING_OFF_CONSENT}{" "}
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
            {pendingPayment &&
            typeof pendingPayment.slots === "number" &&
            typeof pendingPayment.amountCents === "number" ? (
              <p data-testid="unpaid-order" className="text-sm font-medium text-foreground">
                {`Unpaid package: ${pendingPayment.slots} slots, ${formatPlanPrice(pendingPayment.amountCents)}`}
              </p>
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
              {quote.kind !== "invoice" ? (
                <Button
                  variant="trust-verified"
                  size="lg"
                  className="h-12 rounded-full"
                  disabled={!canPay}
                  onClick={pay}
                >
                  {state === "idle" ? (
                    <>
                      <LockKeyhole aria-hidden="true" className="h-4 w-4" />
                      {totalCents === null
                        ? "Pay securely"
                        : `Pay ${formatPlanPrice(totalCents)} securely`}
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
              ) : null}
              <Button asChild variant="ghost" className="h-11 rounded-full">
                <Link href="/pricing/multi-listing">Back to pricing</Link>
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

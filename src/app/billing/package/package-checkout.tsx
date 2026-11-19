"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, LockKeyhole, Minus, Plus, ReceiptText } from "lucide-react";
import { CheckoutShell } from "@/components/billing/checkout-shell";
import { Button } from "@/components/ui/button";
import { formatSaLongDate } from "@/lib/utils/format";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { getFriendlyCheckoutError } from "@/lib/billing/checkout-copy";
import { formatDurationDays, formatPlanPrice } from "@/lib/constants/pricing";
import { INVOICE_COOLING_OFF_CONSENT } from "@/lib/billing/slot-checkout";
import {
  PACKAGE_COOLING_OFF_CONSENT,
  PACKAGE_MAX_SLOTS,
  PACKAGE_MAX_ONLINE_SLOTS,
  PACKAGE_MIN_SLOTS,
  PACKAGE_POSTS_PER_SLOT_PER_30_DAYS,
  PACKAGE_QUICK_SIZES,
  PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS,
  isPackageTerm,
  packageOnlineMaxSlots,
  packageQuote,
  parseSlotCount,
  type PackageTerm,
} from "@/lib/billing/slot-packages";
import { cn } from "@/lib/utils";
import {
  PendingPaymentActions,
  usePendingPayment,
  type PendingPayment,
} from "@/components/billing/pending-payment-actions";

/** One package term on sale (api.get_slot_package_offer). */
export interface PackageCheckoutTerm {
  planId: string;
  days: PackageTerm;
}

/** Why the member cannot buy a package now. */
export type PackageCheckoutBlock = "id_review" | "has_package";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** An "Ask for an invoice" sent for this order (api.request_package_invoice). */
interface InvoiceRequested {
  slots: number;
  days: PackageTerm;
  totalCents: number;
}

/**
 * "Choose your package" (roadmap P4a; the owner's approved draft p4-01/p4-02):
 * the member types the number of slots (5 to 100 online, shortcuts 5, 10, 25,
 * 50 and 100) and picks 30, 90 or 180 days; the total is R100 per slot per 30
 * days. Above Ozow's maximum for one payment (or 100 slots) the package is
 * bought by invoice: the member ticks the invoice's cooling-off box and asks
 * for it here (P4e); staff issue it and it is paid from Invoices. The
 * database applies every rule again; this page is shown only while packages
 * are on sale.
 */
export function PackageCheckout({
  terms,
  initialSlots = 25,
  initialDays = 30,
  block = null,
  onlineMaxCents = null,
  unpaidInvoices = [],
}: {
  terms: PackageCheckoutTerm[];
  initialSlots?: number;
  initialDays?: number;
  block?: PackageCheckoutBlock | null;
  /** The most one online (Ozow) payment may be, in cents; null when unknown
   * (the database still applies it). */
  onlineMaxCents?: number | null;
  /** The member's unpaid Individual slot invoices (their numbers), which can
   * still be paid by bank transfer once the package runs (D6). */
  unpaidInvoices?: string[];
}) {
  const ids = useId();
  const firstTerm = terms.find((term) => term.days === initialDays) ?? terms[0];
  const [days, setDays] = useState<PackageTerm>(firstTerm?.days ?? 30);
  const term = terms.find((entry) => entry.days === days) ?? firstTerm;
  const [text, setText] = useState(String(initialSlots));
  const slots = parseSlotCount(text);
  const quote = packageQuote(slots, days, onlineMaxCents);
  const totalCents = quote.kind === "online" || quote.kind === "invoice" ? quote.totalCents : null;
  const onlineMax = packageOnlineMaxSlots(days, onlineMaxCents);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "submitting" | "redirecting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const { pendingPayment, setPendingPayment, cancelling, cancelPending } =
    usePendingPayment(setError);
  const pending = useRef(false);
  // "Ask for an invoice" (P4e): its own box, and one request id per order so
  // a retried submission is answered once.
  const [invoiceConsent, setInvoiceConsent] = useState(false);
  const [invoiceRequested, setInvoiceRequested] = useState<InvoiceRequested | null>(null);
  const invoiceRequestId = useRef<{ order: string; id: string } | null>(null);

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
  const canAskInvoice =
    !block && quote.kind === "invoice" && invoiceConsent && state === "idle" && term !== undefined;
  const requestedThisOrder =
    invoiceRequested !== null &&
    invoiceRequested.slots === slots &&
    invoiceRequested.days === days &&
    invoiceRequested.totalCents === totalCents;
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

  async function askForInvoice() {
    if (!canAskInvoice || pending.current || !term || totalCents === null || slots === null) return;
    pending.current = true;
    setState("submitting");
    setError(null);
    setNeedsSignIn(false);
    const order = `${term.planId}:${slots}`;
    if (invoiceRequestId.current?.order !== order)
      invoiceRequestId.current = { order, id: crypto.randomUUID() };
    try {
      const res = await fetch("/api/billing/package-invoice", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          planId: term.planId,
          slots,
          expectedTotalCents: totalCents,
          coolingOffConsent: invoiceConsent,
          requestId: invoiceRequestId.current.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success === true) {
        setInvoiceRequested({ slots, days, totalCents });
      } else {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Your request could not be sent. Please try again in a few minutes."
        );
        setNeedsSignIn(res.status === 401);
      }
    } catch {
      setError("Your request could not be sent. Please try again in a few minutes.");
    }
    setState("idle");
    pending.current = false;
  }

  const boxMessage =
    quote.kind === "too_small" || quote.kind === "invalid"
      ? `Packages start at ${PACKAGE_MIN_SLOTS} slots. For 1-4, use Individual slots (R69).`
      : quote.kind === "too_large"
        ? `A package holds at most ${PACKAGE_MAX_SLOTS} slots for now.`
        : onlineMax >= PACKAGE_MIN_SLOTS
          ? `Up to ${onlineMax} slots for ${formatDurationDays(days)} can be paid online.`
          : `A package for ${formatDurationDays(days)} is paid by invoice.`;

  return (
    <CheckoutShell>
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
                    setInvoiceConsent(false);
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
                      setInvoiceConsent(false);
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
                          setInvoiceConsent(false);
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
            <DetailRow label="Starts">
              {quote.kind === "invoice" ? "When your invoice is paid" : "On payment"}
            </DetailRow>
            <DetailRow label="Ends">
              {`${formatDurationDays(days)} later, all slots together (${formatSaLongDate(ends)})`}
            </DetailRow>
            <DetailRow label="Fair use">
              {`Up to ${PACKAGE_POSTS_PER_SLOT_PER_30_DAYS} posts going live per slot per 30 days`}
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
          {!block && unpaidInvoices.length > 0 ? (
            <p
              role="status"
              data-testid="package-unpaid-invoices"
              className="rounded-xl border border-border/80 bg-muted/40 p-3.5 text-sm leading-6 text-foreground/80"
            >
              {unpaidInvoices.length === 1
                ? `You have an unpaid invoice for Individual slots (${unpaidInvoices[0]}). `
                : `You have ${unpaidInvoices.length} unpaid invoices for Individual slots (${unpaidInvoices.join(", ")}). `}
              {
                "If you pay by bank transfer after your package starts, those slots run beside the package until their own end. See "
              }
              <Link
                href="/billing/invoices"
                className="font-medium text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300"
              >
                Invoices
              </Link>
              .
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
            <>
              <div
                role="status"
                data-testid="package-invoice"
                className="flex items-start gap-3 rounded-xl border border-brand-gold-300/70 bg-brand-gold-50/70 p-3.5 text-sm leading-6 text-foreground/80 dark:border-brand-gold-700/50 dark:bg-brand-gold-950/30"
              >
                <ReceiptText
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold-700 dark:text-brand-gold-300"
                />
                <p>
                  {requestedThisOrder ? (
                    <>
                      {
                        "Invoice requested. We will let you know when it is ready; then pay it from "
                      }
                      <Link
                        href="/billing/invoices"
                        className="font-medium text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300"
                      >
                        Invoices
                      </Link>
                      .
                    </>
                  ) : onlineMaxCents !== null &&
                    totalCents !== null &&
                    totalCents > onlineMaxCents ? (
                    `Ozow takes payments of up to ${formatPlanPrice(onlineMaxCents)}, so this package is paid by invoice, at the same price.`
                  ) : (
                    `More than ${PACKAGE_MAX_ONLINE_SLOTS} slots is paid by invoice, at the same price.`
                  )}
                </p>
              </div>
              {requestedThisOrder ? null : (
                <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5">
                  <input
                    type="checkbox"
                    id={`${ids}-invoice-consent`}
                    checked={invoiceConsent}
                    onChange={(event) => setInvoiceConsent(event.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-brand-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:accent-brand-green-400"
                  />
                  <label
                    htmlFor={`${ids}-invoice-consent`}
                    className="cursor-pointer text-sm leading-6 text-foreground/80"
                  >
                    {INVOICE_COOLING_OFF_CONSENT}{" "}
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
              )}
            </>
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
            <PendingPaymentActions
              pendingPayment={pendingPayment}
              cancelling={cancelling}
              onCancel={cancelPending}
            />
          ) : null}
          <div className="flex flex-col gap-1 sm:gap-2">
            {quote.kind === "invoice" && !requestedThisOrder ? (
              <Button
                variant="trust-verified"
                size="lg"
                className="h-12 rounded-full"
                disabled={!canAskInvoice}
                onClick={askForInvoice}
              >
                {state === "idle" ? (
                  <ReceiptText aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                )}
                Ask for an invoice
              </Button>
            ) : null}
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
                    {state === "redirecting" ? "Redirecting to Ozow…" : "Opening secure checkout…"}
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
    </CheckoutShell>
  );
}

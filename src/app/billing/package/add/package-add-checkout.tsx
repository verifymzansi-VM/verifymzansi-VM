"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, Loader2, LockKeyhole, Minus, Plus, ReceiptText } from "lucide-react";
import { CheckoutShell } from "@/components/billing/checkout-shell";
import { Button } from "@/components/ui/button";
import { formatSaLongDate } from "@/lib/utils/format";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { postCheckoutOrder, useBackForwardReset } from "@/lib/billing/checkout-client";
import { formatPlanPrice } from "@/lib/constants/pricing";
import { INVOICE_COOLING_OFF_CONSENT } from "@/lib/billing/slot-checkout";
import {
  PACKAGE_ADD_COOLING_OFF_CONSENT,
  PACKAGE_ADD_MIN_DAYS,
  PACKAGE_ADD_MIN_INVOICE_DAYS,
  PACKAGE_MAX_ONLINE_SLOTS,
  PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS,
  packageAddQuote,
  parseSlotCount,
} from "@/lib/billing/slot-packages";
import {
  PendingPaymentActions,
  usePendingPayment,
} from "@/components/billing/pending-payment-actions";
import { CheckoutTermsLinks, NoVatCharged } from "@/components/billing/checkout-terms-links";

/** The running package as "Add slots" offers it (api.get_my_package_add_offer). */
export interface PackageAddOffer {
  packageId: string;
  places: number;
  endsAt: string;
  daysLeft: number;
  unitPriceCents: number;
  maxSlots: number;
  onlineOpen: boolean;
  invoiceOpen: boolean;
  invoiceUnpaid: boolean;
  /** An added-slots invoice request still waiting for staff. */
  requestOpen: { slots: number; totalCents: number } | null;
}

/** Why the member cannot add slots now. */
export type PackageAddBlock = "id_review" | "no_package" | "too_late";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}

function Consent({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-brand-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:accent-brand-green-400"
      />
      <label htmlFor={id} className="cursor-pointer text-sm leading-6 text-foreground/80">
        {children} <CheckoutTermsLinks />
      </label>
    </div>
  );
}

const daysWord = (days: number) => (days === 1 ? "1 day" : `${days} days`);

/**
 * "Add slots" (roadmap P4b; the owner's approved drafts p4-03 and p4-04, the
 * invoice variant n2 awaiting approval): the member types how many slots to
 * add to their running Multi-listing package. Added slots cost R100 per slot
 * per 30 days for the whole days left and end with the package. Online up to
 * Ozow's maximum and 100 slots in all, while 7 or more days are left;
 * otherwise "Ask for an invoice" while 10 or more are left (D1: the price is
 * fixed when asked; money that arrives after the package ended is refunded in
 * full). The database prices and checks everything again; the page is shown
 * only while packages are on sale.
 */
export function PackageAddCheckout({
  offer,
  block = null,
  onlineMaxCents = null,
  initialSlots = 5,
}: {
  offer: PackageAddOffer | null;
  block?: PackageAddBlock | null;
  /** The most one online (Ozow) payment may be, in cents; null when unknown. */
  onlineMaxCents?: number | null;
  initialSlots?: number;
}) {
  const ids = useId();
  const [text, setText] = useState(String(initialSlots));
  const slots = parseSlotCount(text);
  const quote = offer
    ? packageAddQuote(
        slots,
        {
          unitPriceCents: offer.unitPriceCents,
          places: offer.places,
          maxSlots: offer.maxSlots,
          onlineOpen: offer.onlineOpen,
          invoiceOpen: offer.invoiceOpen,
        },
        onlineMaxCents
      )
    : ({ kind: "invalid" } as const);
  const totalCents = "totalCents" in quote ? quote.totalCents : null;
  const [consent, setConsent] = useState(false);
  const [invoiceConsent, setInvoiceConsent] = useState(false);
  const [state, setState] = useState<"idle" | "submitting" | "redirecting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const { pendingPayment, setPendingPayment, cancelling, cancelPending } =
    usePendingPayment(setError);
  const pending = useRef(false);
  const [requested, setRequested] = useState<{ slots: number; totalCents: number } | null>(
    offer?.requestOpen ?? null
  );
  const requestId = useRef<{ order: string; id: string } | null>(null);

  const settle = () => {
    pending.current = false;
    setState("idle");
  };
  // Back from Ozow: never stuck on "Redirecting…".
  useBackForwardReset(settle);

  const resetConsent = () => {
    setConsent(false);
    setInvoiceConsent(false);
  };
  const step = (by: number) => {
    const next = Math.min(offer?.maxSlots ?? 1, Math.max(1, (slots ?? 0) + by));
    setText(String(next));
    resetConsent();
  };
  const blocked = block !== null || offer === null || offer.invoiceUnpaid;
  const canPay = !blocked && quote.kind === "online" && consent && state === "idle";
  const canAskInvoice =
    !blocked && quote.kind === "invoice" && invoiceConsent && state === "idle" && !requested;
  const addHref = `/billing/package/add?slots=${slots ?? 1}`;
  const busyIcon = <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />;
  // The one main button: ask for an invoice, or pay online.
  const mainAction =
    !offer || blocked || (quote.kind === "invoice" && requested)
      ? null
      : quote.kind === "invoice"
        ? {
            disabled: !canAskInvoice,
            icon:
              state === "idle" ? <ReceiptText aria-hidden="true" className="h-4 w-4" /> : busyIcon,
            label: "Ask for an invoice",
          }
        : {
            disabled: !canPay,
            icon:
              state === "idle" ? <LockKeyhole aria-hidden="true" className="h-4 w-4" /> : busyIcon,
            label: {
              idle:
                totalCents === null
                  ? "Pay securely"
                  : `Pay ${formatPlanPrice(totalCents)} securely`,
              submitting: "Opening secure checkout…",
              redirecting: "Redirecting to Ozow…",
            }[state],
          };

  async function pay() {
    if (!canPay || pending.current || !offer || totalCents === null || slots === null) return;
    pending.current = true;
    setState("submitting");
    setError(null);
    setNeedsSignIn(false);
    const started = await postCheckoutOrder(
      "/api/billing/package-add-checkout",
      {
        packageId: offer.packageId,
        slots,
        expectedTotalCents: totalCents,
        coolingOffConsent: consent,
      },
      "your slots"
    );
    if (started.kind === "redirect") {
      setState("redirecting");
      window.location.assign(started.url);
      return;
    }
    if (started.pendingPayment) setPendingPayment(started.pendingPayment);
    setError(started.message);
    setNeedsSignIn(started.signIn);
    settle();
  }

  async function askForInvoice() {
    if (!canAskInvoice || pending.current || !offer || totalCents === null || slots === null)
      return;
    pending.current = true;
    setState("submitting");
    setError(null);
    setNeedsSignIn(false);
    const order = `${offer.packageId}:${slots}`;
    if (requestId.current?.order !== order) requestId.current = { order, id: crypto.randomUUID() };
    try {
      const res = await fetch("/api/billing/package-add-invoice", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          packageId: offer.packageId,
          slots,
          expectedTotalCents: totalCents,
          coolingOffConsent: invoiceConsent,
          requestId: requestId.current.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success === true) {
        setRequested({ slots, totalCents });
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
    settle();
  }

  if (block === "too_late" && offer) {
    return (
      <CheckoutShell>
        <div className="w-full max-w-md rounded-3xl border border-border/70 bg-card p-5 elev-md sm:p-7">
          <p className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground/80">
            {`Multi-listing · ${offer.places} slots`}
          </p>
          <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-foreground">
            Add slots
          </h1>
          <div
            role="status"
            data-testid="package-add-too-late"
            className="mt-5 flex items-start gap-3 rounded-2xl bg-muted/60 px-4 py-3.5 text-sm leading-6 text-muted-foreground"
          >
            <CalendarClock aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              <span className="font-semibold text-foreground">{`${daysWord(offer.daysLeft)} left.`}</span>
              {` Slots can be added while ${PACKAGE_ADD_MIN_DAYS} or more days are left.`}
            </p>
          </div>
          <Button asChild variant="ghost" className="mt-4 h-11 w-full rounded-full">
            <Link href="/dashboard/slots">Back to My slots</Link>
          </Button>
        </div>
      </CheckoutShell>
    );
  }

  const boxMessage =
    !offer || quote.kind === "invalid"
      ? "Type how many slots to add."
      : quote.kind === "too_large"
        ? `A package holds at most ${offer.places + quote.maxSlots} slots for now.`
        : quote.kind === "closed"
          ? `Above ${onlineMaxCents === null ? "the online limit" : formatPlanPrice(onlineMaxCents)} or ${PACKAGE_MAX_ONLINE_SLOTS} slots in all, slots are added by invoice while ${PACKAGE_ADD_MIN_INVOICE_DAYS} or more days are left. Add fewer slots.`
          : `${offer.places} → ${offer.places + (slots ?? 0)} slots`;

  return (
    <CheckoutShell>
      <div className="grid w-full max-w-md rounded-3xl border border-border/70 bg-card elev-md lg:max-w-4xl lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:grid-rows-[auto_1fr]">
        <div className="p-5 pb-0 sm:p-7 sm:pb-0 lg:col-start-1 lg:row-start-1">
          <p className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground/80">
            {offer ? `Multi-listing · ${offer.places} slots` : "Multi-listing"}
          </p>
          <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-foreground">
            Add slots
          </h1>
          {offer ? (
            <>
              <div className="mt-5 flex items-end justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3.5">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {quote.kind === "invoice" ? "Total" : "Total today"}
                  </p>
                  <p
                    data-testid="package-add-total"
                    className="font-display text-4xl font-extrabold leading-none tracking-tight text-foreground"
                  >
                    {totalCents === null ? "—" : formatPlanPrice(totalCents)}
                  </p>
                  <NoVatCharged />
                </div>
                <p className="pb-0.5 text-right text-xs font-medium text-muted-foreground">
                  {`${slots ?? 0} ${slots === 1 ? "slot" : "slots"} × ${daysWord(offer.daysLeft)} at ${formatPlanPrice(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)} per 30 days`}
                </p>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor={`${ids}-slots`}
                    className="text-sm font-medium text-muted-foreground"
                  >
                    Slots to add
                  </label>
                  <div className="flex items-center gap-1 rounded-full border border-border/80 bg-card p-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 rounded-full"
                      aria-label="One slot fewer"
                      disabled={(slots ?? 0) <= 1}
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
                      size={3}
                      value={text}
                      onChange={(event) => {
                        setText(event.target.value.replace(/[^0-9]/g, "").slice(0, 3));
                        resetConsent();
                      }}
                      aria-describedby={`${ids}-slots-help`}
                      aria-invalid={quote.kind === "invalid" || quote.kind === "too_large"}
                      data-testid="package-add-slots"
                      className="h-11 w-14 rounded-xl bg-transparent text-center font-display text-2xl font-bold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 rounded-full"
                      aria-label="One slot more"
                      disabled={(slots ?? 0) >= offer.maxSlots}
                      onClick={() => step(1)}
                    >
                      <Plus aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <p
                  id={`${ids}-slots-help`}
                  aria-live="polite"
                  data-testid="package-add-slots-help"
                  className={
                    quote.kind === "online" || quote.kind === "invoice"
                      ? "mt-2 text-center text-sm font-medium tabular-nums text-foreground"
                      : "mt-2 text-xs font-medium leading-5 text-destructive"
                  }
                >
                  {boxMessage}
                </p>
              </div>
            </>
          ) : null}
        </div>

        {offer ? (
          <section
            aria-labelledby={`${ids}-details`}
            className="px-5 pt-4 sm:px-7 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:rounded-r-3xl lg:border-l lg:border-border/60 lg:bg-muted/25 lg:py-7"
          >
            <h2 id={`${ids}-details`} className="font-display text-base font-bold text-foreground">
              Details
            </h2>
            <dl className="mt-1 divide-y divide-border/60">
              <DetailRow label="New slots start">
                {quote.kind === "invoice" ? "When your payment clears" : "On payment"}
              </DetailRow>
              <DetailRow label="They end">
                {`With your package, ${formatSaLongDate(offer.endsAt)}`}
              </DetailRow>
              <DetailRow label="Days charged">
                {`${offer.daysLeft} (whole days left today)`}
              </DetailRow>
              {quote.kind === "invoice" ? (
                <DetailRow label="Price">Fixed now, even if it clears later</DetailRow>
              ) : null}
            </dl>
            {quote.kind === "invoice" ? (
              <p className="py-2.5 text-xs leading-5 text-muted-foreground">
                If the money arrives after your package has ended, we refund it in full.
              </p>
            ) : null}
          </section>
        ) : null}

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
                    href={`/login?returnUrl=${encodeURIComponent(addHref)}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    Sign in
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {block === "id_review" ? (
            <div
              role="status"
              data-testid="package-add-block-id_review"
              className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5 text-sm leading-6 text-foreground/80"
            >
              <p>
                Your ID review must be accepted before you add slots, so you never pay for days you
                cannot use.
              </p>
              <Button asChild variant="outline" className="h-11 rounded-full">
                <Link href="/verification">Go to my ID review</Link>
              </Button>
            </div>
          ) : block === "no_package" || offer === null ? (
            <p
              role="status"
              data-testid="package-add-block-no_package"
              className="rounded-xl border border-border/80 bg-muted/40 p-3.5 text-sm leading-6 text-foreground/80"
            >
              Slots are added to a running Multi-listing package. You have none now.
            </p>
          ) : offer.invoiceUnpaid && !requested ? (
            <p
              role="status"
              data-testid="package-add-invoice-unpaid"
              className="rounded-xl border border-border/80 bg-muted/40 p-3.5 text-sm leading-6 text-foreground/80"
            >
              {"Your package invoice is not paid yet. Pay it from "}
              <Link
                href="/billing/invoices"
                className="font-medium text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300"
              >
                Invoices
              </Link>
              {" before adding more slots."}
            </p>
          ) : quote.kind === "invoice" ? (
            <>
              <div
                role="status"
                data-testid="package-add-invoice"
                className="flex items-start gap-3 rounded-xl border border-brand-gold-300/70 bg-brand-gold-50/70 p-3.5 text-sm leading-6 text-foreground/80 dark:border-brand-gold-700/50 dark:bg-brand-gold-950/30"
              >
                <ReceiptText
                  aria-hidden="true"
                  className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold-700 dark:text-brand-gold-300"
                />
                <p>
                  {requested ? (
                    <>
                      {`Invoice requested for ${requested.slots} ${requested.slots === 1 ? "slot" : "slots"} (${formatPlanPrice(requested.totalCents)}). We will let you know when it is ready; then pay it from `}
                      <Link
                        href="/billing/invoices"
                        className="font-medium text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300"
                      >
                        Invoices
                      </Link>
                      .
                    </>
                  ) : (
                    `Above ${onlineMaxCents === null ? "the online limit" : formatPlanPrice(onlineMaxCents)} or ${PACKAGE_MAX_ONLINE_SLOTS} slots in all, we send an invoice. Pay it by bank transfer within 3 days.`
                  )}
                </p>
              </div>
              {requested ? null : (
                <Consent
                  id={`${ids}-invoice-consent`}
                  checked={invoiceConsent}
                  onChange={setInvoiceConsent}
                >
                  {INVOICE_COOLING_OFF_CONSENT}
                </Consent>
              )}
            </>
          ) : quote.kind === "online" ? (
            <Consent id={`${ids}-consent`} checked={consent} onChange={setConsent}>
              {PACKAGE_ADD_COOLING_OFF_CONSENT}
            </Consent>
          ) : null}
          {pendingPayment &&
          typeof pendingPayment.slots === "number" &&
          typeof pendingPayment.amountCents === "number" ? (
            <p data-testid="unpaid-order" className="text-sm font-medium text-foreground">
              {`Unpaid package order: ${pendingPayment.slots} slots, ${formatPlanPrice(pendingPayment.amountCents)}`}
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
            {mainAction ? (
              <Button
                variant="trust-verified"
                size="lg"
                className="h-12 rounded-full"
                disabled={mainAction.disabled}
                onClick={quote.kind === "invoice" ? askForInvoice : pay}
              >
                {mainAction.icon}
                {mainAction.label}
              </Button>
            ) : null}
            <Button asChild variant="ghost" className="h-11 rounded-full">
              <Link href="/dashboard/slots">Back to My slots</Link>
            </Button>
          </div>
        </div>
      </div>
    </CheckoutShell>
  );
}

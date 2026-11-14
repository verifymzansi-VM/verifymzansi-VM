"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { PrintButton } from "./print-button";

export interface InvoicePayPanelProps {
  invoiceNumber: string;
  status: "issued" | "paid" | "void";
  revision: number;
  totalCents: number;
  buyer: { name: string; address: string; registration_number: string | null } | null;
  /** The cooling-off wording the database records with the consent. */
  consentWording: string;
  /** The customer's Ozow page for this invoice is still open. */
  checkoutOpen: boolean;
  /** A bank transfer to this invoice waits for staff to confirm it. */
  transferWaiting?: boolean;
}

const field =
  "mt-1 block w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/billing/invoices", {
    method: "POST",
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/**
 * Next to the invoice (never printed): the customer's billing details, the
 * cooling-off box and "Pay now" (Ozow), and printing. The database checks the
 * owner, the details, the consent and the amount again.
 */
export function InvoicePayPanel({
  invoiceNumber,
  status,
  revision,
  totalCents,
  buyer,
  consentWording,
  checkoutOpen,
  transferWaiting = false,
}: InvoicePayPanelProps) {
  const router = useRouter();
  const busy = useRef(false);
  const [editing, setEditing] = useState(buyer === null);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const failed = (result: { status: number; data: Record<string, unknown> }, fallback: string) => {
    setNeedsSignIn(result.status === 401);
    setError(typeof result.data.error === "string" ? result.data.error : fallback);
  };

  async function saveBilling(form: HTMLFormElement) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    const values = new FormData(form);
    try {
      const result = await post({
        action: "billing",
        invoiceNumber,
        revision,
        buyerName: String(values.get("buyerName") ?? ""),
        buyerAddress: String(values.get("buyerAddress") ?? ""),
        buyerRegistrationNumber: String(values.get("buyerRegistrationNumber") ?? "") || null,
      });
      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else failed(result, "Your billing details could not be saved. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    }
    setSaving(false);
    busy.current = false;
  }

  async function payNow() {
    if (busy.current || !consent || !buyer || editing || transferWaiting) return;
    busy.current = true;
    setPaying(true);
    setError(null);
    try {
      const result = await post({
        action: "pay",
        invoiceNumber,
        expectedTotalCents: totalCents,
        coolingOffConsent: true,
      });
      if (result.ok && typeof result.data.checkoutUrl === "string") {
        window.location.assign(result.data.checkoutUrl);
        return;
      }
      failed(result, "The payment could not be started. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    }
    setPaying(false);
    busy.current = false;
  }

  const errorBlock = error ? (
    <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
      {error}{" "}
      {needsSignIn ? (
        <Link
          href={`/login?returnUrl=${encodeURIComponent(`/billing/invoices/${invoiceNumber}`)}`}
          className="underline"
        >
          Sign in
        </Link>
      ) : null}
    </p>
  ) : null;

  return (
    <aside
      aria-label="Pay this invoice"
      className="no-print min-w-0 space-y-5 rounded-3xl border border-border/70 bg-card p-5 shadow-sm"
    >
      {status === "issued" ? (
        <>
          <section aria-labelledby="invoice-billing" className="space-y-3">
            <h2 id="invoice-billing" className="font-display text-lg font-semibold">
              Your billing details
            </h2>
            {editing ? (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveBilling(event.currentTarget);
                }}
              >
                <label className="block text-sm font-medium">
                  Business or full name
                  <input
                    name="buyerName"
                    required
                    minLength={2}
                    maxLength={160}
                    autoComplete="organization"
                    defaultValue={buyer?.name ?? ""}
                    className={field}
                  />
                </label>
                <label className="block text-sm font-medium">
                  Address
                  <textarea
                    name="buyerAddress"
                    required
                    minLength={5}
                    maxLength={300}
                    rows={3}
                    autoComplete="street-address"
                    defaultValue={buyer?.address ?? ""}
                    className={field}
                  />
                </label>
                <label className="block text-sm font-medium">
                  Company registration number{" "}
                  <span className="font-normal text-muted-foreground">(if you have one)</span>
                  <input
                    name="buyerRegistrationNumber"
                    maxLength={40}
                    autoComplete="off"
                    defaultValue={buyer?.registration_number ?? ""}
                    className={field}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" className="h-11 rounded-full" disabled={saving}>
                    {saving ? (
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : null}
                    Save details
                  </Button>
                  {buyer ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 rounded-full"
                      disabled={saving}
                      onClick={() => setEditing(false)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </form>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-full"
                onClick={() => setEditing(true)}
              >
                Change billing details
              </Button>
            )}
          </section>

          <section aria-labelledby="invoice-pay" className="space-y-3">
            <h2 id="invoice-pay" className="font-display text-lg font-semibold">
              Pay
            </h2>
            {transferWaiting ? (
              <p role="status" className="rounded-xl bg-muted/60 p-3 text-sm">
                Your bank transfer to this invoice is being checked. You do not need to pay again;
                your slots start once it is confirmed.
              </p>
            ) : (
              <>
                <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5">
                  <input
                    type="checkbox"
                    id="invoice-cooling-off"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-brand-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:accent-brand-green-400"
                  />
                  <label
                    htmlFor="invoice-cooling-off"
                    className="cursor-pointer text-sm leading-6 text-foreground/80"
                  >
                    {consentWording}{" "}
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
                {errorBlock}
                <Button
                  type="button"
                  variant="trust-verified"
                  className="h-12 w-full rounded-full text-base"
                  disabled={!consent || !buyer || editing || paying}
                  onClick={() => void payNow()}
                >
                  {paying ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                  {checkoutOpen ? "Continue payment" : "Pay now"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {!buyer || editing
                    ? "Save your billing details first."
                    : "You pay on Ozow's secure page, straight from your bank."}
                </p>
              </>
            )}
          </section>
        </>
      ) : null}
      <PrintButton />
      {status === "issued" ? null : errorBlock}
    </aside>
  );
}

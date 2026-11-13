"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { RETAIL_OFFERS, formatPlanPrice } from "@/lib/constants/pricing";
import {
  ActionMessage,
  AdminCard,
  ReasonField,
  SubmitButton,
  readForm,
  useCommercialAction,
} from "./commercial-action";

/** Bank transfers above R50 000 are refused for now; the database decides. */
const LIMIT_CENTS = 5_000_000;
const TERMS = [30, 90, 180] as const;
const slotPrice = (days: number) =>
  RETAIL_OFFERS.find((offer) => offer.durationDays === days)?.priceCents ?? 0;

/** Rand as typed ("1656", "1 656,00", "R1,656.00") in cents, or null. */
export function randToCents(value: string): number | null {
  const plain = value.replace(/^\s*R/i, "").replace(/[\s ]/g, "");
  // A comma followed by exactly two digits at the end is the decimal mark.
  const normal = /,\d{2}$/.test(plain) ? plain.replace(/\./g, "").replace(",", ".") : plain;
  const digits = normal.replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(digits)) return null;
  const [rand, cents = ""] = digits.split(".");
  return Number(rand) * 100 + Number(cents.padEnd(2, "0"));
}

/** Today in South Africa, YYYY-MM-DD (the latest date money can have cleared). */
function southAfricanToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
}

/**
 * Staff record a bank transfer (EFT) only after the money has cleared: the
 * customer's slots start at once, with the same receipt email and partner
 * commission as an Ozow payment. Audited; the database rechecks everything.
 */
type Customer = {
  customer_name: string | null;
  id_reviewed: boolean;
  can_use_slots: boolean;
  slots_held: number | null;
  slot_limit: number | null;
};

/** Asks the staff route whose account the email names (records nothing). */
async function lookUpCustomer(
  email: string
): Promise<{ customer: Customer } | { error: string; redirect?: string }> {
  try {
    const res = await fetch("/api/admin/commercial", {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ action: "payment.transfer_customer", accountEmail: email }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.data) return { customer: body.data as Customer };
    if (body.code === "step_up_required" || body.code === "mfa_required")
      return {
        error: "",
        redirect: staffVerifyHref(
          "/staff/two-step",
          window.location.pathname + window.location.search
        ),
      };
    return { error: body.error ?? "The customer's account could not be checked." };
  } catch {
    return { error: "Network error. Please try again." };
  }
}

export function BankTransferPanel() {
  const router = useRouter();
  const { run, busy, message } = useCommercialAction();
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState<(typeof TERMS)[number]>(30);
  const [slots, setSlots] = useState(1);
  const [amount, setAmount] = useState("");
  const today = southAfricanToday();
  const totalCents = slotPrice(term) * (Number.isSafeInteger(slots) ? slots : 0);
  const receivedCents = amount.trim() ? randToCents(amount) : null;
  const mismatch = receivedCents !== null && receivedCents !== totalCents;

  return (
    <AdminCard
      title="Record a bank transfer"
      description="Only after the money has cleared in the bank account. The customer's slots start at once and they get the receipt email."
    >
      <ActionMessage message={check ? { tone: "error", text: check } : message} />
      {!open ? (
        <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
          Record a bank transfer
        </Button>
      ) : (
        <form
          className="space-y-3"
          aria-label="Record a bank transfer"
          onSubmit={async (event) => {
            event.preventDefault();
            const values = readForm(event.currentTarget);
            const cents = randToCents(values.amount ?? "");
            if (cents === null) {
              window.alert("Enter the amount received in rand, for example 1656.00.");
              return;
            }
            // Whose account the email names, before anything is recorded.
            setChecking(true);
            setCheck(null);
            const found = await lookUpCustomer(values.accountEmail ?? "");
            setChecking(false);
            if ("error" in found) {
              if (found.redirect) router.push(found.redirect);
              else setCheck(found.error);
              return;
            }
            const customer = found.customer;
            if (!customer.id_reviewed || !customer.can_use_slots) {
              setCheck(
                customer.id_reviewed
                  ? "This customer's account cannot use slots now. Nothing was recorded."
                  : "This customer's ID review is not accepted yet. Nothing was recorded."
              );
              return;
            }
            const who = customer.customer_name ?? "this customer";
            const held =
              customer.slots_held !== null && customer.slot_limit !== null
                ? ` They hold ${customer.slots_held} of ${customer.slot_limit} slots.`
                : "";
            if (
              !window.confirm(
                `Record ${formatPlanPrice(cents)} from ${who} (${values.accountEmail}) for ${slots} × ${term}-day ${slots === 1 ? "slot" : "slots"}?${held} The slots start now and the customer gets a receipt.`
              )
            )
              return;
            const done = await run(
              {
                action: "payment.record_transfer",
                accountEmail: values.accountEmail ?? "",
                termDays: term,
                slots,
                amountCents: cents,
                bankReference: values.bankReference ?? "",
                clearedOn: values.clearedOn ?? "",
                coolingOffWaiver: values.coolingOffWaiver === "on",
                reason: values.reason,
              },
              (data) =>
                (data as { repeated?: boolean } | null)?.repeated
                  ? "This bank transfer was already recorded with these details: nothing new was recorded and no new receipt is sent."
                  : "Bank transfer recorded: the slots have started and the receipt is on its way"
            );
            if (done) {
              setOpen(false);
              setAmount("");
              setSlots(1);
            }
          }}
        >
          <label className="block text-sm">
            <span className="font-medium">Customer&apos;s account email</span>
            <input
              name="accountEmail"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 block w-full rounded-md border bg-background p-2"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">Slot term</span>
              <select
                name="termDays"
                value={term}
                onChange={(event) => setTerm(Number(event.target.value) as (typeof TERMS)[number])}
                className="mt-1 block w-full rounded-md border bg-background p-2"
              >
                {TERMS.map((days) => (
                  <option key={days} value={days}>
                    {days} days · {formatPlanPrice(slotPrice(days))} per slot
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Number of slots</span>
              <input
                name="slots"
                type="number"
                inputMode="numeric"
                required
                min={1}
                max={25}
                value={slots}
                onChange={(event) => setSlots(Math.trunc(Number(event.target.value)))}
                className="mt-1 block w-full rounded-md border bg-background p-2"
              />
            </label>
          </div>
          <p className="text-sm">
            <span className="font-medium">Order total: {formatPlanPrice(totalCents)}</span>{" "}
            {totalCents > LIMIT_CENTS ? (
              <span className="text-destructive">
                Above R50 000: a bank transfer this large cannot be recorded yet.
              </span>
            ) : null}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">Amount received (R)</span>
              <input
                name="amount"
                required
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-describedby={mismatch ? "transfer-amount-mismatch" : undefined}
                className="mt-1 block w-full rounded-md border bg-background p-2"
              />
              {mismatch ? (
                <span id="transfer-amount-mismatch" className="mt-1 block text-destructive">
                  Not the order total. The amount must equal the total.
                </span>
              ) : null}
            </label>
            <label className="block text-sm">
              <span className="font-medium">Date it cleared</span>
              <input
                name="clearedOn"
                type="date"
                required
                max={today}
                defaultValue={today}
                className="mt-1 block w-full rounded-md border bg-background p-2"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-medium">Bank reference</span>
            <input
              name="bankReference"
              required
              maxLength={60}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 block w-full rounded-md border bg-background p-2 font-mono"
              placeholder="As it appears on the bank statement"
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input name="coolingOffWaiver" type="checkbox" required className="mt-0.5 h-4 w-4" />
            <span>
              The customer agreed in writing that their slots start now and the 7-day cooling-off
              does not apply.
            </span>
          </label>
          <ReasonField />
          <div className="flex flex-wrap gap-2">
            <SubmitButton busy={busy || checking}>Record bank transfer</SubmitButton>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </AdminCard>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPlanPrice } from "@/lib/constants/pricing";
import {
  ActionMessage,
  AdminCard,
  ReasonField,
  SubmitButton,
  readForm,
  useCommercialAction,
} from "./commercial-action";
import {
  BankReferenceFields,
  ClearedOnField,
  CustomerEmailField,
  SlotOrderFields,
  southAfricanToday,
  useCustomerCheck,
  useSlotOrder,
} from "./slot-order";

/** Bank transfers above R50 000 are refused for now; the database decides. */
const LIMIT_CENTS = 5_000_000;

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

/**
 * Staff record a bank transfer (EFT) only after the money has cleared; a
 * second staff member confirms it, and only then the customer's slots start,
 * with the same receipt email and partner commission as an Ozow payment.
 * Audited; the database rechecks everything.
 */
export type WaitingTransfer = {
  transfer_id: string;
  customer_name: string | null;
  customer_email: string | null;
  similar_records: number;
  account_id: string;
  term_days: number;
  slots: number;
  amount_received_cents: number;
  bank_reference: string;
  cleared_on: string;
  reason: string;
  recorded_at: string;
  recorded_by_me: boolean;
  recorded_by_name: string | null;
};

const recordedDate = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});

/** Recorded bank transfers waiting for a second staff member, who confirms
 * (the slots start and the receipt is sent) or declines them. */
function WaitingTransfers({
  waiting,
  canConfirm,
}: {
  waiting: WaitingTransfer[];
  canConfirm: boolean;
}) {
  const { run, busy, message } = useCommercialAction();
  // Confirming, declining or withdrawing the last waiting transfer empties
  // the list when the page refreshes: the outcome stays on screen.
  if (waiting.length === 0) return <ActionMessage message={message} />;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Waiting for a second staff member</h3>
      <ActionMessage message={message} />
      <ul className="space-y-2" aria-label="Bank transfers waiting for confirmation">
        {waiting.map((t) => {
          const what = `${formatPlanPrice(t.amount_received_cents)} from ${t.customer_name ?? "the customer"} for ${t.slots} × ${t.term_days}-day ${t.slots === 1 ? "slot" : "slots"}`;
          return (
            <li
              key={t.transfer_id}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
            >
              <span className="font-semibold">{what}</span>
              {t.similar_records > 0 ? (
                <span className="w-full text-destructive" role="note">
                  Possible duplicate: {t.similar_records} other{" "}
                  {t.similar_records === 1 ? "record has" : "records have"} this bank reference and
                  amount, or this customer, amount and date. Check the bank statement.
                </span>
              ) : null}
              <span className="w-full text-xs text-muted-foreground">
                Bank transfer {t.bank_reference}, cleared {t.cleared_on} ·{" "}
                {t.customer_email ?? t.account_id} · Recorded{" "}
                {recordedDate.format(new Date(t.recorded_at))}
                {t.recorded_by_me
                  ? " by you"
                  : t.recorded_by_name
                    ? ` by ${t.recorded_by_name}`
                    : ""}
                {" · "}
                {t.reason}
              </span>
              {canConfirm ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="h-10"
                    disabled={busy || t.recorded_by_me}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Confirm ${what}? Check the bank statement first: the slots start now and the customer gets a receipt.`
                        )
                      )
                        void run(
                          { action: "payment.transfer_confirm", transferId: t.transfer_id },
                          "Bank transfer confirmed: the slots have started and the receipt is on its way"
                        );
                    }}
                  >
                    Confirm transfer
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10"
                    disabled={busy}
                    onClick={() => {
                      const reason = window
                        .prompt("Reason (audited, at least 5 characters):")
                        ?.trim();
                      if (reason && reason.length >= 5)
                        void run(
                          {
                            action: "payment.transfer_decline",
                            transferId: t.transfer_id,
                            reason,
                          },
                          "Bank transfer declined. Its bank reference cannot be recorded again."
                        );
                    }}
                  >
                    {t.recorded_by_me ? "Withdraw" : "Decline"}
                  </Button>
                  {t.recorded_by_me ? (
                    <span className="text-xs text-muted-foreground">
                      You recorded it: another staff member must confirm it.
                    </span>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BankTransferPanel({
  canRecord,
  canConfirm,
  waiting,
}: {
  canRecord: boolean;
  canConfirm: boolean;
  waiting: WaitingTransfer[];
}) {
  const { run, busy, message } = useCommercialAction();
  const { checking, check, checkCustomer } = useCustomerCheck("Nothing was recorded.");
  const order = useSlotOrder();
  const { term, slots, setSlots, totalCents } = order;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const today = southAfricanToday();
  const receivedCents = amount.trim() ? randToCents(amount) : null;
  const mismatch = receivedCents !== null && receivedCents !== totalCents;

  return (
    <AdminCard
      title="Record a bank transfer"
      description="Only after the money has cleared in the bank account. Another staff member then confirms it; only then the customer's slots start and they get the receipt email."
    >
      <p className="text-sm text-muted-foreground">
        Paid an invoice? Record the transfer on the invoice (open it under Invoices), so it pays the
        invoice.
      </p>
      <WaitingTransfers waiting={waiting} canConfirm={canConfirm} />
      <ActionMessage message={check ? { tone: "error", text: check } : message} />
      {!canRecord ? null : !open ? (
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
            const customer = await checkCustomer(values.accountEmail ?? "");
            if (!customer) return;
            const who = customer.customer_name ?? "this customer";
            const held =
              customer.slots_held !== null && customer.slot_limit !== null
                ? ` They hold ${customer.slots_held} of ${customer.slot_limit} slots.`
                : "";
            if (
              !window.confirm(
                `Record ${formatPlanPrice(cents)} from ${who} (${values.accountEmail}) for ${slots} × ${term}-day ${slots === 1 ? "slot" : "slots"}?${held} Another staff member must confirm it before the slots start.`
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
              (data) => {
                const reply = data as { repeated?: boolean; status?: string } | null;
                if (!reply?.repeated)
                  return "Bank transfer recorded. It waits for another staff member to confirm it; no slot starts until then.";
                const state =
                  reply.status === "confirmed"
                    ? "it was confirmed"
                    : reply.status === "declined"
                      ? "it was declined"
                      : "it still waits for confirmation";
                return `This bank transfer was already recorded with these details (${state}): nothing new was recorded.`;
              }
            );
            if (done) {
              setOpen(false);
              setAmount("");
              setSlots(1);
            }
          }}
        >
          <CustomerEmailField />
          <SlotOrderFields order={order} />
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
            <ClearedOnField today={today} />
          </div>
          <BankReferenceFields />
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

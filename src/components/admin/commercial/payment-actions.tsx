"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPlanPrice } from "@/lib/constants/pricing";
import type { RefundReasonCode } from "@/lib/foundation/staff-payments";
import { ReasonField, SubmitButton, readForm, type CommercialPayload } from "./commercial-action";
import { RefundAmountFields, readRefund, type RefundRoom } from "./refund-amount";

/** Why money is returned (the owner's closed list), in staff words. */
export const REFUND_REASON_LABELS = {
  billing_error: "Billing error",
  duplicate: "Duplicate payment",
  our_failure_after_fix_offered: "Our failure, after a fix was offered",
  s14_cancellation: "Cancellation (section 14)",
  breach_credit: "Credit for our breach",
  renewal_cancelled_before_start: "Cancelled before the renewal started",
  first_purchase_cancelled: "First purchase cancelled (within 5 business days)",
} as const satisfies Record<RefundReasonCode, string>;

/** The reasons staff can choose. "Cancelled before the renewal started" is
 * offered only on a renewal payment; the database accepts it only while the
 * renewal's days have not started (renewal_already_started otherwise). "First
 * purchase cancelled" is offered only for the whole payment of an account's
 * first purchase, once the page could read it (the database checks it). */
export function refundReasonOptions(renewal: boolean, firstPurchase = false) {
  return Object.entries(REFUND_REASON_LABELS).filter(
    ([code]) =>
      (renewal || code !== "renewal_cancelled_before_start") &&
      (firstPurchase || code !== "first_purchase_cancelled")
  );
}

/** A payment of the renewal checkout (its description starts "Renewal: "). */
export function isRenewalPayment(description: string) {
  return description.startsWith("Renewal: ");
}

/** Above R1 000 returned on one payment (refunds and chargebacks together,
 * this one included), a second staff member must approve. The database
 * decides; this only words the form. */
const APPROVAL_ABOVE_CENTS = 100_000;

export type RefundTarget = {
  /** The whole payment, or one slot (payment line) of it. */
  scope: "payment" | "slot";
  id: string;
  kind: "refunded" | "chargeback";
  amountCents: number;
  /** Money already returned on this payment (refunded or charged back slots). */
  priorCents: number;
  label: string;
  /** Null once the paying account was erased. */
  accountId: string | null;
  /** How the money goes back: an Ozow refund; a bank transfer back for a bank
   * transfer ("invoice"); or a bank transfer back for an Ozow payment once
   * Ozow's 13 days for a refund have passed ("bank", refunds only; the
   * database decides when they have). */
  method?: "ozow" | "invoice" | "bank";
  /** For "bank": the date until which Ozow refunds the payment (a hint). */
  ozowRefundUntil?: string;
  /** A renewal payment: "Cancelled before the renewal started" is offered. */
  renewal?: boolean;
  /** The payment of a slot (scope "slot"). */
  paymentId?: string;
  /** What is left to refund: a refund can then be part of it; a chargeback
   * warns when money was already refunded on the payment. */
  room?: RefundRoom;
};

type Run = (payload: CommercialPayload, successText?: string) => Promise<unknown>;

/** The refund or chargeback form: Ozow's reference, a reason code and a note. */
export function RefundForm({
  target,
  busy,
  run,
  onDone,
  requestId,
  onRecorded,
}: {
  target: RefundTarget;
  busy: boolean;
  run: Run;
  onDone: () => void;
  /** The request id of this payment or slot, kept by the list until the
   * refund is recorded: sent again after a lost answer, even when the form is
   * opened again, so it is never refunded twice. */
  requestId: string;
  /** The refund was recorded: the list forgets its request id. */
  onRecorded?: () => void;
}) {
  const refund = target.kind === "refunded";
  // Part refunds and the first purchase (refunds only, once the page could
  // read what is left to refund).
  const room = refund ? target.room : undefined;
  const refundedBefore = refund ? 0 : (target.room?.refundedCents ?? 0);
  const [reasonCode, setReasonCode] = useState("");
  const [amount, setAmount] = useState(room ? (room.leftCents / 100).toFixed(2) : "");
  const [problem, setProblem] = useState<string | null>(null);
  const what = refund ? "refund" : "chargeback";
  const bank = target.method === "invoice" || (target.method === "bank" && refund);
  const priorCents = room ? room.refundedCents : target.priorCents;
  return (
    <form
      className="w-full space-y-3 rounded-lg border bg-muted/40 p-3"
      aria-label={`${refund ? "Refund" : "Chargeback"} of ${target.label}`}
      onSubmit={async (event) => {
        event.preventDefault();
        const values = readForm(event.currentTarget);
        const part = readRefund(values, room, target.amountCents);
        setProblem("error" in part ? part.error : null);
        if ("error" in part) return;
        const { cents, keeps } = part;
        const needsApproval = priorCents + cents > APPROVAL_ABOVE_CENTS;
        if (
          !window.confirm(
            needsApproval
              ? `Record this ${what} of ${formatPlanPrice(cents)}? It takes effect when another staff member approves it.`
              : `Record this ${what} of ${formatPlanPrice(cents)}? ${
                  keeps ? "The slot keeps running." : "Paid visibility will be withdrawn."
                }`
          )
        )
          return;
        const extras = Object.keys(part.extras).length > 0;
        const done = await run(
          extras
            ? {
                action: "payment.refund",
                paymentId: target.scope === "slot" ? target.paymentId : target.id,
                lineId: target.scope === "slot" ? target.id : null,
                ...part.extras,
                requestId,
                reasonCode: values.reasonCode,
                ozowReference: values.ozowReference ?? "",
                reason: values.reason,
              }
            : {
                action: target.scope === "slot" ? "payment.reverse_slot" : "payment.reverse",
                ...(target.scope === "slot" ? { lineId: target.id } : { paymentId: target.id }),
                kind: target.kind,
                reasonCode: values.reasonCode,
                ozowReference: values.ozowReference ?? "",
                reason: values.reason,
              },
          needsApproval
            ? `${refund ? "Refund" : "Chargeback"} recorded. It waits for another staff member's approval.`
            : "Payment updated"
        );
        if (done) {
          onRecorded?.();
          onDone();
        }
      }}
    >
      <p className="text-sm">
        <span className="font-medium">
          {refund ? "Refund" : "Chargeback"} of {target.label}:{" "}
          {formatPlanPrice(target.amountCents)}
        </span>{" "}
        <span className="text-muted-foreground">
          to the account that paid ({target.accountId})
          {priorCents + target.amountCents > APPROVAL_ABOVE_CENTS
            ? ". Above R1 000 returned on this payment: another staff member must approve it."
            : "."}
        </span>
      </p>
      {refundedBefore > 0 ? (
        <p role="note" className="text-sm font-medium">
          Already returned {formatPlanPrice(refundedBefore)} on this payment. A chargeback returns
          the full amount again: check with Ozow or the bank before recording it.
        </p>
      ) : null}
      {bank && refund ? (
        <p className="text-sm font-medium">
          Before you pay:{" "}
          {target.method === "bank"
            ? `Ozow refunds this payment until ${target.ozowRefundUntil ?? "13 days after it"}; pay it back by bank transfer only after that (before then, refund it through Ozow). `
            : ""}
          If a renewal of this slot is waiting, refund the renewal first: this refund is refused
          while one waits.
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="font-medium">Reason</span>
        <select
          name="reasonCode"
          required
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value)}
          className="mt-1 block w-full rounded-md border bg-background p-2"
        >
          <option value="" disabled>
            Choose a reason
          </option>
          {refundReasonOptions(
            target.renewal === true,
            target.scope === "payment" && room?.firstPurchaseAskUntil != null
          ).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {room ? (
        <RefundAmountFields
          room={room}
          reasonCode={reasonCode}
          fullCents={target.amountCents}
          amount={amount}
          onAmount={setAmount}
        />
      ) : null}
      <label className="block text-sm">
        <span className="font-medium">
          {bank
            ? refund
              ? "Bank reference of the refund transfer"
              : "Bank chargeback reference"
            : refund
              ? "Ozow refund reference"
              : "Ozow chargeback reference"}
        </span>
        <input
          name="ozowReference"
          required
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          className="mt-1 block w-full rounded-md border bg-background p-2 font-mono"
          placeholder={
            bank ? "From the bank's payment confirmation" : "From the Ozow merchant dashboard"
          }
        />
      </label>
      <ReasonField />
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton busy={busy}>{refund ? "Record refund" : "Record chargeback"}</SubmitButton>
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

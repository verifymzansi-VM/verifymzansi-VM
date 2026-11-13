"use client";

import { Button } from "@/components/ui/button";
import { formatPlanPrice } from "@/lib/constants/pricing";
import { ReasonField, SubmitButton, readForm, type CommercialPayload } from "./commercial-action";

/** Why money is returned (the owner's closed list), in staff words. */
export const REFUND_REASON_LABELS = {
  billing_error: "Billing error",
  duplicate: "Duplicate payment",
  our_failure_after_fix_offered: "Our failure, after a fix was offered",
  s14_cancellation: "Cancellation (section 14)",
  breach_credit: "Credit for our breach",
} as const;

/** Refunds above R1 000 wait for a second staff member. */
const APPROVAL_ABOVE_CENTS = 100_000;

export type RefundTarget = {
  /** The whole payment, or one slot (payment line) of it. */
  scope: "payment" | "slot";
  id: string;
  kind: "refunded" | "chargeback";
  amountCents: number;
  label: string;
  accountId: string;
};

type Run = (payload: CommercialPayload, successText?: string) => Promise<unknown>;

/** The refund or chargeback form: Ozow's reference, a reason code and a note. */
export function RefundForm({
  target,
  busy,
  run,
  onDone,
}: {
  target: RefundTarget;
  busy: boolean;
  run: Run;
  onDone: () => void;
}) {
  const refund = target.kind === "refunded";
  const needsApproval = refund && target.amountCents > APPROVAL_ABOVE_CENTS;
  return (
    <form
      className="w-full space-y-3 rounded-lg border bg-muted/40 p-3"
      aria-label={`${refund ? "Refund" : "Chargeback"} of ${target.label}`}
      onSubmit={async (event) => {
        event.preventDefault();
        const values = readForm(event.currentTarget);
        if (
          !window.confirm(
            needsApproval
              ? `Record this refund of ${formatPlanPrice(target.amountCents)}? It takes effect when another staff member approves it.`
              : `Record this ${refund ? "refund" : "chargeback"} of ${formatPlanPrice(target.amountCents)}? Paid visibility will be withdrawn.`
          )
        )
          return;
        const done = await run(
          {
            action: target.scope === "slot" ? "payment.reverse_slot" : "payment.reverse",
            ...(target.scope === "slot" ? { lineId: target.id } : { paymentId: target.id }),
            kind: target.kind,
            reasonCode: values.reasonCode,
            ozowReference: values.ozowReference ?? "",
            reason: values.reason,
          },
          needsApproval
            ? "Refund recorded. It waits for another staff member's approval."
            : "Payment updated"
        );
        if (done) onDone();
      }}
    >
      <p className="text-sm">
        <span className="font-medium">
          {refund ? "Refund" : "Chargeback"} of {target.label}:{" "}
          {formatPlanPrice(target.amountCents)}
        </span>{" "}
        <span className="text-muted-foreground">
          to the account that paid ({target.accountId})
          {needsApproval ? ". Above R1 000: another staff member must approve it." : "."}
        </span>
      </p>
      <label className="block text-sm">
        <span className="font-medium">Reason</span>
        <select
          name="reasonCode"
          required
          defaultValue=""
          className="mt-1 block w-full rounded-md border bg-background p-2"
        >
          <option value="" disabled>
            Choose a reason
          </option>
          {Object.entries(REFUND_REASON_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium">
          {refund ? "Ozow refund reference" : "Ozow chargeback reference"}
        </span>
        <input
          name="ozowReference"
          required
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          className="mt-1 block w-full rounded-md border bg-background p-2 font-mono"
          placeholder="From the Ozow merchant dashboard"
        />
      </label>
      <ReasonField />
      <div className="flex flex-wrap gap-2">
        <SubmitButton busy={busy}>{refund ? "Record refund" : "Record chargeback"}</SubmitButton>
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

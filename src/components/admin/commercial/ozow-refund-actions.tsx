"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPlanPrice } from "@/lib/constants/pricing";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { ActionMessage, AdminCard, ReasonField, SubmitButton, readForm } from "./commercial-action";
import { REFUND_REASON_LABELS } from "./payment-actions";

/**
 * Refunds through Ozow (shown only while OZOW_API_REFUNDS_ENABLED is on):
 * - "Refund through Ozow": the server sends the refund to Ozow once the
 *   approval rules pass; staff type no reference;
 * - "Recorded in the Ozow dashboard": an admin records a refund already made
 *   by hand in the Ozow dashboard, with Ozow's refund id;
 * - each payment shows its Ozow refunds and their state; refunds that failed,
 *   came back or are stuck are listed for staff at the top.
 */

/** One Ozow refund record as the staff page receives it. */
export type OzowRefundRow = {
  id: string;
  payment_id: string;
  line_id: string | null;
  channel: "api" | "dashboard";
  status:
    "awaiting_approval" | "approved" | "sent" | "applied" | "failed" | "returned" | "declined";
  amount_cents: number;
  reason_code: keyof typeof REFUND_REASON_LABELS;
  requested_at: string;
  sent_at: string | null;
  failure_reason: string | null;
  ozow_refund_id: string | null;
  ozow_status: string | null;
  send_attempts: number;
  ozow_missing_at: string | null;
  requested_by_me: boolean;
};

/** What the payments list needs to offer refunds through Ozow. */
export type OzowRefundsView = {
  /** Payments paid through Ozow (only these can be refunded through it). */
  refundable: string[];
  records: OzowRefundRow[];
};

export type OzowRefundTarget = {
  mode: "api" | "dashboard";
  paymentId: string;
  /** One slot of the payment, or null for the whole payment. */
  lineId: string | null;
  amountCents: number;
  priorCents: number;
  label: string;
  accountId: string;
};

const APPROVAL_ABOVE_CENTS = 100_000;
const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});

/** Plain words for each state of an Ozow refund. */
export const OZOW_REFUND_STATUS_WORDS: Record<OzowRefundRow["status"], string> = {
  awaiting_approval: "waiting for approval",
  approved: "approved, sending to Ozow",
  sent: "sent to Ozow",
  applied: "refunded",
  failed: "failed at Ozow",
  returned: "came back from the bank",
  declined: "declined",
};
const FAILURE_WORDS: Record<string, string> = {
  ozow_refused: "Ozow refused it",
  ozow_auth: "Ozow refused the refund key",
  ozow_failed: "Ozow could not pay it (check the refund float)",
  ozow_cancelled: "cancelled at Ozow",
  ozow_invalid: "Ozow found it invalid",
  payment_changed: "the payment changed before it was sent",
  closed_by_staff: "closed by staff: it never reached Ozow",
};

/** Posts to the Ozow refunds route and refreshes the page. */
export function useOzowRefundAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  async function run(
    payload: Record<string, unknown>,
    success: (status: string, answered: boolean) => string
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/payments/ozow-refunds", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.code === "step_up_required" || body.code === "mfa_required") {
          router.push(
            staffVerifyHref("/staff/two-step", window.location.pathname + window.location.search)
          );
          return false;
        }
        setMessage({ tone: "error", text: body.error ?? "The refund could not be recorded." });
        router.refresh();
        return false;
      }
      setMessage({
        tone: "success",
        text: success(String(body.data?.status ?? ""), body.data?.answered === true),
      });
      router.refresh();
      return true;
    } catch {
      setMessage({
        tone: "error",
        text: "Network error. Reload the page to see whether the refund was recorded before trying again.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, message };
}

function outcomeText(status: string, answered: boolean) {
  if (status === "awaiting_approval")
    return "Refund recorded. It waits for another staff member's approval, then goes to Ozow.";
  if (status === "sent" && answered)
    return "Ozow accepted the refund. The payment changes when Ozow confirms it is paid.";
  if (status === "sent")
    return "Refund sent to Ozow, but Ozow's answer has not arrived yet. Do not refund it again: it is checked automatically and listed under 'Refunds that need staff' if Ozow does not have it.";
  if (status === "applied") return "Ozow confirmed the refund. The payment is refunded.";
  if (status === "failed")
    return "Ozow did not accept the refund. It is listed under 'Refunds that need staff'.";
  return "Refund approved. It is sent to Ozow within 10 minutes.";
}

/** The refund form for a refund through Ozow, or one made in the dashboard. */
export function OzowRefundForm({
  target,
  onDone,
}: {
  target: OzowRefundTarget;
  onDone: () => void;
}) {
  const { run, busy, message } = useOzowRefundAction();
  const needsApproval = target.priorCents + target.amountCents > APPROVAL_ABOVE_CENTS;
  const dashboard = target.mode === "dashboard";
  return (
    <form
      className="w-full space-y-3 rounded-lg border bg-muted/40 p-3"
      aria-label={`${dashboard ? "Ozow dashboard refund" : "Refund through Ozow"} of ${target.label}`}
      onSubmit={async (event) => {
        event.preventDefault();
        const values = readForm(event.currentTarget);
        const amount = formatPlanPrice(target.amountCents);
        if (
          !window.confirm(
            dashboard
              ? needsApproval
                ? `Record the Ozow dashboard refund of ${amount}? It takes effect when another staff member approves it.`
                : `Record the Ozow dashboard refund of ${amount}? Paid visibility will be withdrawn.`
              : needsApproval
                ? `Refund ${amount} through Ozow? Another staff member must approve it before it is sent.`
                : `Send a refund of ${amount} to Ozow now? Ozow pays it from the refund float.`
          )
        )
          return;
        const done = await run(
          {
            action: dashboard ? "refund.dashboard" : "refund.request",
            paymentId: target.paymentId,
            lineId: target.lineId,
            reasonCode: values.reasonCode,
            reason: values.reason,
            ...(dashboard ? { ozowRefundId: values.ozowRefundId ?? "" } : {}),
          },
          dashboard
            ? (status) =>
                status === "awaiting_approval"
                  ? "Dashboard refund recorded. It waits for another staff member's approval."
                  : "Dashboard refund recorded. The payment is refunded."
            : outcomeText
        );
        if (done) onDone();
      }}
    >
      <p className="text-sm">
        <span className="font-medium">
          {dashboard ? "Refund made in the Ozow dashboard" : "Refund through Ozow"}: {target.label},{" "}
          {formatPlanPrice(target.amountCents)}
        </span>{" "}
        <span className="text-muted-foreground">
          to the account that paid ({target.accountId})
          {needsApproval
            ? ". Above R1 000 returned on this payment: another staff member must approve it."
            : "."}
          {dashboard
            ? " Admins only: use this only for a refund already made by hand in the Ozow dashboard (before refunds through Ozow, or while they are unavailable)."
            : " The server sends it to Ozow; Ozow pays it to the account or card the payment came from."}
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
      {dashboard ? (
        <label className="block text-sm">
          <span className="font-medium">Ozow refund id</span>
          <input
            name="ozowRefundId"
            required
            maxLength={36}
            autoComplete="off"
            spellCheck={false}
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            className="mt-1 block w-full rounded-md border bg-background p-2 font-mono"
            placeholder="The refund's id in the Ozow dashboard"
          />
        </label>
      ) : null}
      <ReasonField />
      <ActionMessage message={message} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton busy={busy}>
          {dashboard ? "Record dashboard refund" : "Refund through Ozow"}
        </SubmitButton>
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Approves an Ozow refund that waits for a second staff member. */
export function OzowApproveButton({
  requestId,
  amountCents,
  disabled,
}: {
  requestId: string;
  amountCents: number;
  disabled: boolean;
}) {
  const { run, busy, message } = useOzowRefundAction();
  return (
    <>
      <Button
        size="sm"
        className="h-10"
        disabled={disabled || busy}
        onClick={() => {
          if (
            window.confirm(
              `Approve this refund of ${formatPlanPrice(amountCents)}? It is sent to Ozow now.`
            )
          )
            void run({ action: "refund.approve", requestId }, outcomeText);
        }}
      >
        Approve and send to Ozow
      </Button>
      <ActionMessage message={message} />
    </>
  );
}

function RecordLine({ record }: { record: OzowRefundRow }) {
  const bad = record.status === "failed" || record.status === "returned";
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span>
        {record.channel === "api" ? "Ozow refund" : "Ozow dashboard refund"}{" "}
        {formatPlanPrice(record.amount_cents)}
        {record.line_id ? " (one slot)" : ""}
      </span>
      <Badge variant={bad ? "destructive" : record.status === "applied" ? "default" : "secondary"}>
        {OZOW_REFUND_STATUS_WORDS[record.status]}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {REFUND_REASON_LABELS[record.reason_code]} · {date.format(new Date(record.requested_at))}
        {record.failure_reason
          ? ` · ${FAILURE_WORDS[record.failure_reason] ?? record.failure_reason}`
          : ""}
        {record.ozow_refund_id ? ` · Ozow ${record.ozow_refund_id}` : ""}
      </span>
    </li>
  );
}

/** A payment's Ozow refunds, on its row in the payments list. */
export function OzowRefundRecords({ records }: { records: OzowRefundRow[] }) {
  if (records.length === 0) return null;
  return (
    <ul
      className="w-full space-y-1 border-t pt-2 text-sm"
      aria-label="Ozow refunds of this payment"
    >
      {records.map((record) => (
        <RecordLine key={record.id} record={record} />
      ))}
    </ul>
  );
}

/** A refund through Ozow that never reached Ozow: approved and never sent,
 * or a lost send that Ozow, read a day later, does not have. The database
 * decides; this only offers the button. */
function closable(record: OzowRefundRow) {
  if (record.channel !== "api" || record.requested_by_me) return false;
  if (record.status === "approved") return record.send_attempts === 0;
  return (
    record.status === "sent" &&
    record.ozow_refund_id === null &&
    record.ozow_missing_at !== null &&
    record.sent_at !== null &&
    Date.parse(record.ozow_missing_at) - Date.parse(record.sent_at) >= 86_400_000
  );
}

function OzowCloseButton({ record }: { record: OzowRefundRow }) {
  const { run, busy, message } = useOzowRefundAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="h-10"
        disabled={busy}
        onClick={() => {
          if (
            !window.confirm(
              "Close this refund? Only do this after checking the Ozow dashboard: Ozow has no refund for it. The payment can then be refunded again."
            )
          )
            return;
          const reason = (window.prompt("Reason (audited, 5–500 characters)") ?? "").trim();
          if (reason.length >= 5)
            void run(
              { action: "refund.close", requestId: record.id, reason },
              () => "Closed. Nothing was refunded; the payment can be refunded again."
            );
        }}
      >
        Close: never reached Ozow
      </Button>
      <ActionMessage message={message} />
    </div>
  );
}

/** Ozow refunds that need staff: failed, came back, or stuck for a day. */
export function OzowRefundAttention({ records }: { records: OzowRefundRow[] }) {
  if (records.length === 0) return null;
  return (
    <AdminCard
      title={`Refunds that need staff (${records.length})`}
      description="Ozow did not pay these refunds, the money came back, or Ozow has not answered for a day. Nothing was changed on the payment. Check the refund float and the payment in the Ozow dashboard, then refund again if the money is still owed."
    >
      <ul className="space-y-2 text-sm">
        {records.map((record) => (
          <li key={record.id} className="space-y-1 rounded-lg border p-3">
            <span className="block text-xs text-muted-foreground">Payment {record.payment_id}</span>
            <ul>
              <RecordLine record={record} />
            </ul>
            {closable(record) ? <OzowCloseButton record={record} /> : null}
          </li>
        ))}
      </ul>
    </AdminCard>
  );
}

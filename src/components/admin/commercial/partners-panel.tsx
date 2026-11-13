"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { REFUND_REASON_LABELS, RefundForm, type RefundTarget } from "./payment-actions";
import {
  OzowApproveButton,
  OzowRefundForm,
  OzowRefundRecords,
  type OzowRefundTarget,
  type OzowRefundsView,
} from "./ozow-refund-actions";

export interface AdminPartner {
  id: string;
  user_id: string;
  code: string;
  status: string;
  commission_bps: number | null;
  displayName: string | null;
  referrals: number;
}

export interface AdminCommission {
  id: string;
  partner_id: string;
  partnerCode: string;
  base_cents: number;
  amount_cents: number;
  rate_bps: number;
  status: string;
  requires_manual_approval: boolean;
  eligible_at: string;
  created_at: string;
  paymentStatus: string | null;
}

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});
const input = "mt-1 block w-full rounded-md border bg-background p-2";

function askReason(): string | null {
  const reason = window.prompt("Reason (audited, 5–500 characters)") ?? "";
  return reason.trim().length >= 5 ? reason.trim() : null;
}

export function PartnersPanel({
  partners,
  commissions,
  defaultRateBps,
  appUrl,
  nativeRetailOnly = false,
}: {
  partners: AdminPartner[];
  commissions: AdminCommission[];
  defaultRateBps: number;
  appUrl: string;
  nativeRetailOnly?: boolean;
}) {
  const create = useCommercialAction();
  const rowAction = useCommercialAction();

  return (
    <div className="space-y-6">
      <AdminCard
        title="Add a partner / agent"
        description={`Default commission is ${defaultRateBps / 100}% of collected retail revenue. No commission on free trials, events, programmes, self-referrals, refunds or chargebacks.${nativeRetailOnly ? "" : " Institutional payments always need manual approval."}`}
      >
        <form
          className="grid gap-3 sm:grid-cols-4 sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const form = readForm(event.currentTarget);
            void create.run(
              {
                action: "partner.manage",
                userId: form.userId,
                operation: "create",
                values: {
                  code: form.code.toUpperCase(),
                  commissionBps: form.rate ? Math.round(Number(form.rate) * 100) : null,
                  notes: form.notes || undefined,
                },
                reason: form.reason,
              },
              "Partner created"
            );
          }}
        >
          <label className="text-sm sm:col-span-2">
            Partner account ID
            <input name="userId" required pattern="[0-9a-fA-F-]{36}" className={input} />
          </label>
          <label className="text-sm">
            Referral code
            <input name="code" required pattern="[A-Za-z0-9]{4,16}" className={input} />
          </label>
          <label className="text-sm">
            Custom rate % (optional)
            <input name="rate" type="number" min={0} max={50} step="0.5" className={input} />
          </label>
          <label className="text-sm sm:col-span-4">
            Notes
            <input name="notes" maxLength={1000} className={input} />
          </label>
          <div className="sm:col-span-3">
            <ReasonField />
          </div>
          <SubmitButton busy={create.busy}>Create partner</SubmitButton>
        </form>
        <ActionMessage message={create.message} />
      </AdminCard>

      <AdminCard title={`Partners (${partners.length})`}>
        <ActionMessage message={rowAction.message} />
        <ul className="grid gap-3 md:grid-cols-2">
          {partners.map((partner) => (
            <li key={partner.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{partner.displayName ?? "Partner"}</p>
                <Badge variant="outline">{partner.code}</Badge>
                <Badge variant={partner.status === "active" ? "default" : "secondary"}>
                  {partner.status}
                </Badge>
              </div>
              <p className="break-all text-xs text-muted-foreground">
                {appUrl}/?ref={partner.code} · {partner.referrals} referred accounts ·{" "}
                {(partner.commission_bps ?? defaultRateBps) / 100}% commission
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-10"
                disabled={rowAction.busy}
                onClick={() => {
                  const reason = askReason();
                  if (reason)
                    void rowAction.run({
                      action: "partner.manage",
                      userId: partner.user_id,
                      operation: partner.status === "active" ? "suspend" : "activate",
                      values: {},
                      reason,
                    });
                }}
              >
                {partner.status === "active" ? "Suspend" : "Activate"}
              </Button>
            </li>
          ))}
        </ul>
      </AdminCard>

      <AdminCard
        title="Commissions"
        description="Pending commissions are approved automatically after the pending period if the payment is still collected, unless manual approval is required."
      >
        <ul className="space-y-2">
          {commissions.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
            >
              <Badge variant="outline">{c.partnerCode}</Badge>
              <span className="font-semibold">{formatPlanPrice(c.amount_cents)}</span>
              <span className="text-muted-foreground">
                of {formatPlanPrice(c.base_cents)} at {c.rate_bps / 100}% ·{" "}
                {date.format(new Date(c.created_at))} · payment {c.paymentStatus ?? "?"}
              </span>
              <Badge variant={c.status === "REVERSED" ? "secondary" : "default"}>{c.status}</Badge>
              {c.requires_manual_approval ? (
                <Badge variant="secondary">Manual approval</Badge>
              ) : null}
              <span className="ml-auto flex flex-wrap gap-2">
                {c.status === "PENDING" ? (
                  <Button
                    size="sm"
                    className="h-10"
                    disabled={rowAction.busy}
                    onClick={() => {
                      const reason = askReason();
                      if (reason)
                        void rowAction.run({
                          action: "commission.manage",
                          commissionId: c.id,
                          operation: "approve",
                          values: {},
                          reason,
                        });
                    }}
                  >
                    Approve
                  </Button>
                ) : null}
                {c.status === "APPROVED" ? (
                  <Button
                    size="sm"
                    className="h-10"
                    disabled={rowAction.busy}
                    onClick={() => {
                      const reference = window.prompt("Payout reference") ?? "";
                      const reason = askReason();
                      if (reason)
                        void rowAction.run({
                          action: "commission.manage",
                          commissionId: c.id,
                          operation: "mark_paid",
                          values: { reference },
                          reason,
                        });
                    }}
                  >
                    Mark paid
                  </Button>
                ) : null}
                {c.status !== "REVERSED" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-10 text-destructive"
                    disabled={rowAction.busy}
                    onClick={() => {
                      const reason = askReason();
                      if (reason)
                        void rowAction.run({
                          action: "commission.manage",
                          commissionId: c.id,
                          operation: "reverse",
                          values: {},
                          reason,
                        });
                    }}
                  >
                    Reverse
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
          {commissions.length === 0 ? (
            <li className="text-sm text-muted-foreground">No commissions yet.</li>
          ) : null}
        </ul>
      </AdminCard>
    </div>
  );
}

export interface AdminPaymentRow {
  id: string;
  user_id: string;
  area: string;
  amount_cents: number;
  status: string;
  created_at: string;
  description: string;
  /** Delivery status (new backend): whether what was paid for was given. */
  fulfillment_status?: string;
  merchant_reference?: string;
  activated_at?: string | null;
  /** Set when staff recorded this payment from a cleared bank transfer. */
  bank_transfer?: { bank_reference: string; cleared_on: string } | null;
  lines?: {
    id: string;
    line_number: number;
    amount_cents: number;
    status: string;
    reversal_kind: string | null;
  }[];
  refund_request?: {
    id: string;
    line_id: string | null;
    kind: "refunded" | "chargeback";
    reason_code: keyof typeof REFUND_REASON_LABELS;
    amount_cents: number;
    ozow_reference: string;
    requested_at: string;
    requested_by_me: boolean;
  } | null;
}

export function PaymentsPanel({
  payments,
  canRefund,
  ozow,
}: {
  payments: AdminPaymentRow[];
  canRefund: boolean;
  /** Refunds through Ozow: set when the database has them (see the page). */
  ozow?: OzowRefundsView;
}) {
  const { run, busy, message } = useCommercialAction();
  const [form, setForm] = useState<RefundTarget | null>(null);
  const [ozowForm, setOzowForm] = useState<OzowRefundTarget | null>(null);
  return (
    <AdminCard
      title="Recent payments"
      description={
        ozow?.api
          ? "Refunds and chargebacks withdraw the paid visibility, revoke the posting slot, reverse partner commission and are audited. A refund through Ozow is sent to Ozow by the server and takes effect when Ozow confirms it. Record a chargeback with Ozow's reference."
          : "Refunds and chargebacks withdraw the paid visibility, revoke the posting slot, reverse partner commission and are audited. Refund the money in Ozow first, then record it here with Ozow's reference."
      }
    >
      <ActionMessage message={message} />
      <ul className="space-y-2">
        {payments.map((p) => {
          const lines = p.lines ?? [];
          const request = p.refund_request ?? null;
          const paidNotDelivered =
            p.status === "complete" && p.fulfillment_status === "needs_reconciliation";
          const slotReversed = lines.some((line) => line.status === "reversed");
          const priorCents = lines
            .filter((line) => line.status === "reversed")
            .reduce((sum, line) => sum + line.amount_cents, 0);
          const ozowRecords = ozow ? ozow.records.filter((r) => r.payment_id === p.id) : [];
          // Ozow refund paths, only for payments paid through Ozow: while
          // switched on, or once typed references retired for them.
          const throughOzow =
            ozow !== undefined && (ozow.api || ozow.retired) && ozow.refundable.includes(p.id);
          const sendThroughOzow = throughOzow && ozow?.api === true;
          const inFlight = ozowRecords.some((r) => r.status === "approved" || r.status === "sent");
          const ozowRequest = request ? ozowRecords.find((r) => r.id === request.id) : undefined;
          const canReverse = canRefund && p.status === "complete" && !request && !inFlight;
          const openOzow = (
            mode: OzowRefundTarget["mode"],
            lineId: string | null,
            cents: number,
            label: string
          ) =>
            setOzowForm({
              mode,
              paymentId: p.id,
              lineId,
              amountCents: cents,
              priorCents,
              label,
              accountId: p.user_id,
            });
          return (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
            >
              <span className="font-semibold">{formatPlanPrice(p.amount_cents)}</span>
              <span>{p.description}</span>
              <Badge variant={p.status === "complete" ? "default" : "secondary"}>
                {p.status === "complete" ? "paid" : p.status}
              </Badge>
              {paidNotDelivered ? (
                <Badge variant="destructive">not delivered</Badge>
              ) : p.status === "complete" && p.fulfillment_status === "fulfilled" ? (
                <Badge variant="secondary">delivered</Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {date.format(new Date(p.created_at))} · {p.user_id}
                {p.bank_transfer
                  ? ` · Bank transfer ${p.bank_transfer.bank_reference}, cleared ${p.bank_transfer.cleared_on}`
                  : p.merchant_reference
                    ? ` · Ref ${p.merchant_reference}`
                    : ""}
                {p.activated_at
                  ? ` · Activated by staff ${date.format(new Date(p.activated_at))}`
                  : ""}
              </span>
              {canRefund && paidNotDelivered && !request ? (
                <span className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    className="h-10"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Activate what was paid for? The member gets it now, and it is audited."
                        )
                      )
                        return;
                      const reason = askReason();
                      if (reason)
                        void run(
                          { action: "payment.activate", paymentId: p.id, reason },
                          "Activated: the member now has what they paid for"
                        );
                    }}
                  >
                    Activate what was paid for
                  </Button>
                </span>
              ) : null}
              {canReverse && !slotReversed ? (
                <span className={paidNotDelivered ? "flex gap-2" : "ml-auto flex flex-wrap gap-2"}>
                  {throughOzow ? (
                    <>
                      {sendThroughOzow ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-10"
                          disabled={busy}
                          onClick={() =>
                            openOzow(
                              "api",
                              null,
                              p.amount_cents,
                              lines.length > 1 ? "the whole order" : "this payment"
                            )
                          }
                        >
                          Refund through Ozow
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-10"
                        disabled={busy}
                        onClick={() =>
                          openOzow(
                            "dashboard",
                            null,
                            p.amount_cents,
                            lines.length > 1 ? "the whole order" : "this payment"
                          )
                        }
                      >
                        Recorded in the Ozow dashboard
                      </Button>
                    </>
                  ) : null}
                  {(throughOzow
                    ? (["chargeback"] as const)
                    : (["refunded", "chargeback"] as const)
                  ).map((kind) => (
                    <Button
                      key={kind}
                      size="sm"
                      variant="outline"
                      className="h-10"
                      disabled={busy}
                      onClick={() =>
                        setForm({
                          scope: "payment",
                          id: p.id,
                          kind,
                          amountCents: p.amount_cents,
                          priorCents,
                          label: lines.length > 1 ? `the whole order` : "this payment",
                          accountId: p.user_id,
                          method: p.bank_transfer ? "invoice" : "ozow",
                        })
                      }
                    >
                      {kind === "refunded" ? "Record refund" : "Record chargeback"}
                    </Button>
                  ))}
                </span>
              ) : null}
              {lines.length > 1 ? (
                <ul className="w-full space-y-1 border-t pt-2" aria-label="Slots in this payment">
                  {lines.map((line) => (
                    <li key={line.id} className="flex flex-wrap items-center gap-2">
                      <span>
                        Slot {line.line_number} · {formatPlanPrice(line.amount_cents)}
                      </span>
                      {line.status === "reversed" ? (
                        <Badge variant="secondary">{line.reversal_kind ?? "reversed"}</Badge>
                      ) : null}
                      {canReverse && line.status === "open" ? (
                        <span className="ml-auto flex flex-wrap gap-2">
                          {throughOzow ? (
                            <>
                              {sendThroughOzow ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-10"
                                  disabled={busy}
                                  onClick={() =>
                                    openOzow(
                                      "api",
                                      line.id,
                                      line.amount_cents,
                                      `slot ${line.line_number}`
                                    )
                                  }
                                >
                                  Refund this slot through Ozow
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-10"
                                disabled={busy}
                                onClick={() =>
                                  openOzow(
                                    "dashboard",
                                    line.id,
                                    line.amount_cents,
                                    `slot ${line.line_number}`
                                  )
                                }
                              >
                                Slot recorded in the Ozow dashboard
                              </Button>
                            </>
                          ) : null}
                          {(throughOzow
                            ? (["chargeback"] as const)
                            : (["refunded", "chargeback"] as const)
                          ).map((kind) => (
                            <Button
                              key={kind}
                              size="sm"
                              variant="outline"
                              className="h-10"
                              disabled={busy}
                              onClick={() =>
                                setForm({
                                  scope: "slot",
                                  id: line.id,
                                  kind,
                                  amountCents: line.amount_cents,
                                  priorCents,
                                  label: `slot ${line.line_number}`,
                                  accountId: p.user_id,
                                  method: p.bank_transfer ? "invoice" : "ozow",
                                })
                              }
                            >
                              {kind === "refunded" ? "Refund this slot" : "Slot chargeback"}
                            </Button>
                          ))}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {request ? (
                <div className="w-full space-y-2 rounded-lg border border-brand-gold-300 bg-brand-gold-50 p-3 dark:bg-brand-gold-900/20">
                  <p>
                    <span className="font-medium">
                      {request.kind === "refunded" ? "Refund" : "Chargeback"} of{" "}
                      {formatPlanPrice(request.amount_cents)} waiting for approval
                    </span>{" "}
                    <span className="text-muted-foreground">
                      · {REFUND_REASON_LABELS[request.reason_code]} ·{" "}
                      {ozowRequest?.channel === "api"
                        ? "sent through Ozow once approved"
                        : `${p.bank_transfer ? "Bank" : "Ozow"} ${request.ozow_reference}`}
                    </span>
                  </p>
                  {canRefund ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {ozowRequest?.channel === "api" ? (
                        <OzowApproveButton
                          requestId={request.id}
                          amountCents={request.amount_cents}
                          disabled={busy || request.requested_by_me}
                        />
                      ) : (
                        <Button
                          size="sm"
                          className="h-10"
                          disabled={busy || request.requested_by_me}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Approve this refund of ${formatPlanPrice(request.amount_cents)}? It takes effect now.`
                              )
                            )
                              void run(
                                { action: "payment.refund_approve", requestId: request.id },
                                "Refund approved"
                              );
                          }}
                        >
                          Approve refund
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10"
                        disabled={busy}
                        onClick={() => {
                          const reason = askReason();
                          if (reason)
                            void run(
                              { action: "payment.refund_decline", requestId: request.id, reason },
                              "Refund declined"
                            );
                        }}
                      >
                        {request.requested_by_me ? "Withdraw" : "Decline"}
                      </Button>
                      {request.requested_by_me ? (
                        <span className="text-xs text-muted-foreground">
                          You recorded it: another staff member must approve it.
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {form &&
              (form.scope === "slot" ? lines.some((l) => l.id === form.id) : form.id === p.id) ? (
                <RefundForm target={form} busy={busy} run={run} onDone={() => setForm(null)} />
              ) : null}
              {ozowForm && ozowForm.paymentId === p.id ? (
                <OzowRefundForm target={ozowForm} onDone={() => setOzowForm(null)} />
              ) : null}
              <OzowRefundRecords records={ozowRecords} />
            </li>
          );
        })}
      </ul>
    </AdminCard>
  );
}

"use client";

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
}: {
  partners: AdminPartner[];
  commissions: AdminCommission[];
  defaultRateBps: number;
  appUrl: string;
}) {
  const create = useCommercialAction();
  const rowAction = useCommercialAction();

  return (
    <div className="space-y-6">
      <AdminCard
        title="Add a partner / agent"
        description={`Default commission is ${defaultRateBps / 100}% of collected retail revenue. No commission on free trials, events, programmes, self-referrals, refunds or chargebacks. Institutional payments always need manual approval.`}
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
}

export function PaymentsPanel({
  payments,
  canRefund,
}: {
  payments: AdminPaymentRow[];
  canRefund: boolean;
}) {
  const { run, busy, message } = useCommercialAction();
  return (
    <AdminCard
      title="Recent payments"
      description="Refunds and chargebacks withdraw the paid visibility, revoke the posting slot, reverse partner commission and are audited. Record the provider refund separately in Ozow."
    >
      <ActionMessage message={message} />
      <ul className="space-y-2">
        {payments.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
          >
            <span className="font-semibold">{formatPlanPrice(p.amount_cents)}</span>
            <span>{p.description}</span>
            <Badge variant={p.status === "complete" ? "default" : "secondary"}>
              {p.status === "complete" ? "paid" : p.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {date.format(new Date(p.created_at))} · {p.user_id}
            </span>
            {canRefund && p.status === "complete" ? (
              <span className="ml-auto flex gap-2">
                {(["refunded", "chargeback"] as const).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant="outline"
                    className="h-10"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Record a ${kind} for this payment? Paid visibility will be withdrawn.`
                        )
                      )
                        return;
                      const reason = askReason();
                      if (reason)
                        void run(
                          { action: "payment.reverse", paymentId: p.id, kind, reason },
                          "Payment updated"
                        );
                    }}
                  >
                    {kind === "refunded" ? "Record refund" : "Record chargeback"}
                  </Button>
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </AdminCard>
  );
}

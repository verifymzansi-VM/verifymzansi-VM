"use client";

import { useState } from "react";
import Link from "next/link";
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
import { CustomerEmailField, SlotOrderFields, useCustomerCheck, useSlotOrder } from "./slot-order";

/** An invoice in the staff list (api.get_staff_invoices). */
export type StaffInvoiceRow = {
  invoice_id: string;
  invoice_number: string;
  status: "issued" | "paid" | "void";
  customer_email: string | null;
  customer_name: string | null;
  description: string;
  total_cents: number;
  issued_at: string;
  due_on: string;
  issued_by_me: boolean;
  latest_attempt: { status: string; checkout_open: boolean } | null;
};

const issuedDate = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});

const STATUS: Record<StaffInvoiceRow["status"], string> = {
  issued: "unpaid",
  paid: "paid",
  void: "void",
};

/**
 * Staff issue a customer invoice for Individual slots (P2b): the database
 * numbers (VM-YYYY-NNNNNN, without gaps) and prices it; the customer adds
 * billing details and pays it with Ozow from their invoice page. Audited.
 * The latest invoices are listed; an unpaid one can be voided (it keeps its
 * number).
 */
export function InvoicePanel({
  canIssue,
  invoices,
  unpaid,
}: {
  canIssue: boolean;
  invoices: StaffInvoiceRow[];
  unpaid: number;
}) {
  const { run, busy, message } = useCommercialAction();
  const { checking, check, checkCustomer } = useCustomerCheck("No invoice was issued.");
  const order = useSlotOrder();
  const { term, slots, setSlots, totalCents } = order;
  const [open, setOpen] = useState(false);
  // One per form: a retried submission returns the first invoice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  return (
    <AdminCard
      title="Invoices"
      description="Issue an invoice the customer pays online with Ozow from their invoice page. A bank transfer to the invoice number is recorded above."
    >
      <ActionMessage message={check ? { tone: "error", text: check } : message} />
      {!canIssue ? null : !open ? (
        <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
          Issue an invoice
        </Button>
      ) : (
        <form
          className="space-y-3"
          aria-label="Issue an invoice"
          onSubmit={async (event) => {
            event.preventDefault();
            const values = readForm(event.currentTarget);
            const customer = await checkCustomer(values.accountEmail ?? "");
            if (!customer) return;
            const who = customer.customer_name ?? "this customer";
            if (
              !window.confirm(
                `Issue an invoice of ${formatPlanPrice(totalCents)} to ${who} (${values.accountEmail}) for ${slots} × ${term}-day ${slots === 1 ? "slot" : "slots"}? Its number is kept even if it is voided later.`
              )
            )
              return;
            const done = (await run(
              {
                action: "invoice.issue",
                accountEmail: values.accountEmail ?? "",
                termDays: term,
                slots,
                dueDays: Number(values.dueDays),
                requestId,
                reason: values.reason,
              },
              (data) => {
                const reply = data as { invoice_number?: string; repeated?: boolean } | null;
                return reply?.repeated
                  ? `Invoice ${reply.invoice_number} was already issued with these details.`
                  : `Invoice ${reply?.invoice_number ?? ""} issued. Open it to copy the link for the customer.`;
              }
            )) as { invoice_number?: string } | null;
            if (done) {
              setOpen(false);
              setSlots(1);
              setRequestId(crypto.randomUUID());
            }
          }}
        >
          <CustomerEmailField />
          <SlotOrderFields order={order} className="sm:grid-cols-3">
            <label className="block text-sm">
              <span className="font-medium">Days to pay</span>
              <input
                name="dueDays"
                type="number"
                inputMode="numeric"
                required
                min={1}
                max={30}
                defaultValue={7}
                className="mt-1 block w-full rounded-md border bg-background p-2"
              />
            </label>
          </SlotOrderFields>
          <p className="text-sm font-medium">Invoice total: {formatPlanPrice(totalCents)}</p>
          <ReasonField />
          <div className="flex flex-wrap gap-2">
            <SubmitButton busy={busy || checking}>Issue invoice</SubmitButton>
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
      {invoices.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Latest invoices{unpaid > 0 ? ` · ${unpaid} unpaid` : ""}
          </h3>
          <ul className="space-y-2" aria-label="Latest invoices">
            {invoices.map((invoice) => (
              <li
                key={invoice.invoice_id}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
              >
                <Link
                  href={`/admin/payments/invoices/${invoice.invoice_number}`}
                  className="font-mono font-semibold underline"
                >
                  {invoice.invoice_number}
                </Link>
                <span className="font-semibold">{formatPlanPrice(invoice.total_cents)}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {STATUS[invoice.status]}
                  {invoice.status === "issued" && invoice.latest_attempt?.checkout_open
                    ? " · paying now"
                    : ""}
                </span>
                <span className="w-full text-xs text-muted-foreground">
                  {invoice.description} · {invoice.customer_name ?? "Customer"} (
                  {invoice.customer_email ?? "no email"}) · issued{" "}
                  {issuedDate.format(new Date(invoice.issued_at))}
                  {invoice.issued_by_me ? " by you" : ""} · due {invoice.due_on}
                </span>
                {canIssue && invoice.status === "issued" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10"
                    disabled={busy}
                    onClick={() => {
                      const reason = window
                        .prompt(
                          `Void invoice ${invoice.invoice_number}? It keeps its number and can never be paid. Reason (audited, at least 5 characters):`
                        )
                        ?.trim();
                      if (reason && reason.length >= 5)
                        void run(
                          { action: "invoice.void", invoiceId: invoice.invoice_id, reason },
                          `Invoice ${invoice.invoice_number} voided.`
                        );
                    }}
                  >
                    Void
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </AdminCard>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ActionMessage,
  AdminCard,
  ReasonField,
  SubmitButton,
  readForm,
  useCommercialAction,
} from "./commercial-action";
import { BankReferenceFields, ClearedOnField, southAfricanToday } from "./slot-order";

/**
 * Staff record a cleared bank transfer to an invoice (P2b): the database takes
 * the customer, slots and amount from the invoice. Another staff member then
 * confirms it under 'Waiting for a second staff member' on Payments & Refunds;
 * only that pays the invoice and starts the slots. Audited.
 */
export function InvoiceTransferForm({ invoiceNumber }: { invoiceNumber: string }) {
  const { run, busy, message } = useCommercialAction();
  const [open, setOpen] = useState(false);
  const today = southAfricanToday();
  return (
    <AdminCard
      title="Record a bank transfer to this invoice"
      description="Only after the money has cleared in the bank account. Another staff member then confirms it on Payments & Refunds; only then the invoice is paid and the slots start."
    >
      <ActionMessage message={message} />
      {!open ? (
        <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
          Record a bank transfer
        </Button>
      ) : (
        <form
          className="space-y-3"
          aria-label="Record a bank transfer to this invoice"
          onSubmit={async (event) => {
            event.preventDefault();
            const values = readForm(event.currentTarget);
            const done = await run(
              {
                action: "invoice.record_transfer",
                invoiceNumber,
                bankReference: values.bankReference ?? "",
                clearedOn: values.clearedOn ?? "",
                coolingOffWaiver: values.coolingOffWaiver === "on",
                reason: values.reason,
              },
              (data) =>
                (data as { repeated?: boolean } | null)?.repeated
                  ? "This bank transfer was already recorded with these details: nothing new was recorded."
                  : "Bank transfer recorded. It waits for another staff member to confirm it; the invoice is paid only then."
            );
            if (done) setOpen(false);
          }}
        >
          <ClearedOnField today={today} />
          <BankReferenceFields />
          <ReasonField />
          <div className="flex flex-wrap gap-2">
            <SubmitButton busy={busy}>Record bank transfer</SubmitButton>
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

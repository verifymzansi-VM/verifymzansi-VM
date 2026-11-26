import type { CustomerInvoice } from "@/lib/foundation/customer-invoices";
import { invoiceBankDetails, invoiceSellerAddress } from "@/lib/billing/invoice-settings";
import { InvoiceDocument } from "./invoice-document";
import { InvoicePayPanel } from "./invoice-pay-panel";

/**
 * An unpaid or settled invoice as its own page shows it: the document and,
 * beside it (below on phones), the payment panel. Shared by the member's
 * invoice page and the invoice payment link page (`linkToken`: the payer is
 * not signed in, and Pay now is on this page).
 */
export function InvoiceWithPayPanel({
  invoice,
  onlineMaxCents,
  transferExpired = false,
  linkToken,
}: {
  invoice: Omit<CustomerInvoice, "invoice_id" | "payment_id" | "latest_attempt"> & {
    latest_attempt: { checkout_open: boolean } | null;
  };
  onlineMaxCents: number | null;
  transferExpired?: boolean;
  linkToken?: string;
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] print:block">
      <InvoiceDocument
        headingLevel="h1"
        invoice={invoice}
        sellerAddress={invoiceSellerAddress()}
        bank={invoice.status === "issued" ? invoiceBankDetails() : null}
        onlineMaxCents={onlineMaxCents}
        payHere={linkToken !== undefined}
      />
      <InvoicePayPanel
        invoiceNumber={invoice.invoice_number}
        status={invoice.status}
        revision={invoice.revision}
        totalCents={invoice.total_cents}
        buyer={invoice.buyer}
        consentWording={invoice.consent.wording}
        checkoutOpen={invoice.latest_attempt?.checkout_open === true}
        transferWaiting={invoice.transfer_waiting}
        transferExpired={transferExpired}
        onlineMaxCents={onlineMaxCents}
        linkToken={linkToken}
      />
    </div>
  );
}

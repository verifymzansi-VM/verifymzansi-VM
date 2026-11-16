import { Badge } from "@/components/ui/badge";
import { formatRandAmount, formatSaLongDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { CustomerInvoice } from "@/lib/foundation/customer-invoices";
import type { InvoiceBankDetails } from "@/lib/billing/invoice-settings";

/** Rand with cents, as on an invoice ("R1 035.00"). */
export function formatInvoiceAmount(cents: number) {
  return `R${formatRandAmount(cents / 100, 2)}`;
}

/** The status the invoice shows, from its own status and its payment's. */
export function invoiceStatusLabel(
  invoice: Pick<CustomerInvoice, "status" | "payment_status" | "due_on">,
  today = new Date()
): { label: string; variant: "live" | "pending" | "rejected" | "draft" } {
  if (invoice.status === "void") return { label: "Cancelled", variant: "draft" };
  if (invoice.status === "paid")
    return invoice.payment_status === "refunded" || invoice.payment_status === "chargeback"
      ? { label: "Paid, then refunded", variant: "draft" }
      : { label: "Paid", variant: "live" };
  const todaySa = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(
    today
  );
  return invoice.due_on < todaySa
    ? { label: "Overdue", variant: "rejected" }
    : { label: "Unpaid", variant: "pending" };
}

/** The date part of a YYYY-MM-DD South African date ("21 November 2026"). */
function formatDueDate(date: string) {
  return formatSaLongDate(`${date}T12:00:00+02:00`);
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * The customer invoice (P2b): a plain document the browser prints or saves as
 * PDF. "Invoice", never "tax invoice": VerifyMzansi is not registered for VAT,
 * so there is no VAT line. The seller's address and the bank transfer section
 * appear only when the owner has set them (server-side settings).
 */
export function InvoiceDocument({
  invoice,
  sellerAddress,
  bank,
  className,
  headingLevel: Heading = "h2",
}: {
  invoice: CustomerInvoice;
  sellerAddress: string | null;
  bank: InvoiceBankDetails | null;
  className?: string;
  /** h1 when the invoice is the page itself. */
  headingLevel?: "h1" | "h2";
}) {
  const status = invoiceStatusLabel(invoice);
  const lineDescription = invoice.description.replace(/^\d+ × /, "");
  return (
    <article
      aria-labelledby="invoice-title"
      className={cn(
        "min-w-0 rounded-3xl border border-border/70 bg-card p-5 text-sm shadow-sm sm:p-8 print:rounded-none print:border-0 print:p-0",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <Heading id="invoice-title" className="font-display text-3xl font-bold tracking-tight">
            Invoice
          </Heading>
          <p className="mt-1 font-mono text-base font-semibold" data-testid="invoice-number">
            {invoice.invoice_number}
          </p>
        </div>
        <Badge variant={status.variant} className="text-sm" data-testid="invoice-status">
          {status.label}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-4 border-b border-border/60 py-5">
        <Detail label="Date issued">{formatSaLongDate(invoice.issued_at)}</Detail>
        <Detail label="Due date">{formatDueDate(invoice.due_on)}</Detail>
      </dl>

      <div className="grid gap-6 border-b border-border/60 py-5 sm:grid-cols-2">
        <section aria-labelledby="invoice-from">
          <h3
            id="invoice-from"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            From
          </h3>
          <p className="mt-1 font-semibold">{invoice.seller.legal_name}</p>
          <p>Registration number {invoice.seller.registration_number}</p>
          {sellerAddress ? <p>{sellerAddress}</p> : null}
          <p className="mt-2 text-muted-foreground">VerifyMzansi is not registered for VAT.</p>
        </section>
        <section aria-labelledby="invoice-to">
          <h3
            id="invoice-to"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Bill to
          </h3>
          {invoice.buyer ? (
            <>
              <p className="mt-1 font-semibold">{invoice.buyer.name}</p>
              <p className="whitespace-pre-line">{invoice.buyer.address}</p>
              {invoice.buyer.registration_number ? (
                <p>Registration number {invoice.buyer.registration_number}</p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-muted-foreground">Billing details not added yet.</p>
          )}
        </section>
      </div>

      <div className="overflow-x-auto py-5">
        <table className="w-full text-left">
          <caption className="sr-only">What this invoice is for</caption>
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="pb-2 font-medium">
                Description
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Quantity
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Unit price
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border/60">
              <td className="py-3">
                {lineDescription}
                <span className="block text-xs text-muted-foreground">
                  Each slot runs {invoice.term_days} days from the day this invoice is paid.
                </span>
              </td>
              <td className="py-3 text-right tabular-nums">{invoice.slots}</td>
              <td className="py-3 text-right tabular-nums">
                {formatInvoiceAmount(invoice.unit_price_cents)}
              </td>
              <td className="py-3 text-right tabular-nums">
                {formatInvoiceAmount(invoice.total_cents)}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/80">
              <th scope="row" colSpan={3} className="pt-3 text-right font-semibold">
                {invoice.status === "paid" ? "Total paid" : "Total due"}
              </th>
              <td
                className="pt-3 text-right text-base font-bold tabular-nums"
                data-testid="invoice-total"
              >
                {formatInvoiceAmount(invoice.total_cents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {invoice.status === "paid" && invoice.paid_at ? (
        <p className="rounded-xl bg-muted/60 p-3">
          Paid on {formatSaLongDate(invoice.paid_at)}. Thank you.
        </p>
      ) : invoice.status === "void" ? (
        <p className="rounded-xl bg-muted/60 p-3">This invoice was cancelled and cannot be paid.</p>
      ) : (
        <section aria-labelledby="invoice-how-to-pay" className="space-y-3">
          <h3 id="invoice-how-to-pay" className="font-semibold">
            How to pay
          </h3>
          <p>
            Pay online with Ozow, straight from your bank: sign in at verifymzansi.com, open this
            invoice under Invoices and choose <strong>Pay now</strong>. Your slots start as soon as
            the payment is confirmed. The invoice number is your payment reference.
          </p>
          {bank ? (
            <div className="rounded-xl border border-border/70 p-3" data-testid="invoice-bank">
              <p className="font-medium">Or pay by bank transfer (EFT)</p>
              <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <Detail label="Account name">{bank.accountName}</Detail>
                <Detail label="Bank">{bank.bankName}</Detail>
                <Detail label="Account number">
                  <span className="font-mono">{bank.accountNumber}</span>
                </Detail>
                <Detail label="Branch code">
                  <span className="font-mono">{bank.branchCode}</span>
                </Detail>
                <Detail label="Reference">
                  <span className="font-mono">{invoice.payment_reference}</span>
                </Detail>
              </dl>
              <p className="mt-2 text-muted-foreground">
                Use the reference exactly. A bank transfer is checked by two people before your
                slots start, which can take a few working days.
              </p>
            </div>
          ) : null}
        </section>
      )}
    </article>
  );
}

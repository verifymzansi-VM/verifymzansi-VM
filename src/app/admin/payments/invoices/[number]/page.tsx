import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/require-staff";
import { PageHeader } from "@/components/layout/page-header";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { PrintButton } from "@/components/billing/print-button";
import { InvoiceTransferForm } from "@/components/admin/commercial/invoice-transfer-form";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readStaffInvoice } from "@/lib/foundation/customer-invoices";
import { invoiceBankDetails, invoiceSellerAddress } from "@/lib/billing/invoice-settings";
import { formatSaLongDate } from "@/lib/utils/format";

export const metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

/**
 * One customer invoice as staff see it (payments:view): the document the
 * customer sees, who it is for, who issued it and why, and the link the
 * customer opens to pay it (only their own signed-in account can).
 */
export default async function StaffInvoicePage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const staff = await requireStaff("payments:view");
  const canRecord = staff.assignedCapabilities?.includes("payments:refund") === true;
  const { number } = await params;
  const { api } = await readFoundationServerSession();
  const invoice = await readStaffInvoice(api, number);
  if (!invoice) notFound();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://verifymzansi.com";
  return (
    <div className="space-y-6">
      <PageHeader
        className="no-print"
        title={`Invoice ${invoice.invoice_number}`}
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Payments & Refunds", href: "/admin/payments" },
          { label: "Invoice" },
        ]}
      />
      <dl className="no-print grid gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Customer</dt>
          <dd className="font-medium">
            {invoice.customer_name ?? "Customer"} ({invoice.customer_email ?? "no email"})
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Issued</dt>
          <dd className="font-medium">
            {invoice.issued_by_me ? "By you" : `By ${invoice.issued_by_name ?? "staff"}`}:{" "}
            {invoice.issue_reason}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">The customer pays it here (signed in)</dt>
          <dd className="break-all font-mono">
            {`${appUrl}/billing/invoices/${invoice.invoice_number}`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Ozow payment attempts</dt>
          <dd className="font-medium">
            {invoice.attempts}
            {invoice.latest_attempt?.checkout_open ? " (paying now)" : ""}
          </dd>
        </div>
        {invoice.status === "void" && invoice.voided_at ? (
          <div>
            <dt className="text-muted-foreground">Voided</dt>
            <dd className="font-medium">
              {formatSaLongDate(invoice.voided_at)}: {invoice.void_reason}
            </dd>
          </div>
        ) : null}
      </dl>
      {invoice.extra_payments.length > 0 ? (
        <p
          role="alert"
          className="no-print rounded-xl border border-destructive/40 p-3 text-sm text-destructive"
        >
          Paid twice: {invoice.extra_payments.length} other{" "}
          {invoice.extra_payments.length === 1 ? "payment" : "payments"} of this invoice arrived
          after it was paid or voided. Nothing was delivered for{" "}
          {invoice.extra_payments.length === 1 ? "it" : "them"}; refund{" "}
          {invoice.extra_payments.length === 1 ? "it" : "them"} on Payments &amp; Refunds (
          {invoice.extra_payments.join(", ")}).
        </p>
      ) : null}
      {invoice.status !== "issued" ? null : invoice.transfer_waiting ? (
        <p role="status" className="no-print rounded-xl bg-muted/60 p-3 text-sm">
          A bank transfer to this invoice waits for a second staff member on Payments &amp; Refunds.
          Confirming it pays the invoice.
        </p>
      ) : canRecord ? (
        <div className="no-print">
          <InvoiceTransferForm invoiceNumber={invoice.invoice_number} />
        </div>
      ) : null}
      <InvoiceDocument
        invoice={invoice}
        sellerAddress={invoiceSellerAddress()}
        bank={invoice.status === "issued" ? invoiceBankDetails() : null}
      />
      <PrintButton />
    </div>
  );
}

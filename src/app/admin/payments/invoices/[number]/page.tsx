import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/require-staff";
import { PageHeader } from "@/components/layout/page-header";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { PrintButton } from "@/components/billing/print-button";
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
  await requireStaff("payments:view");
  const { number } = await params;
  const { api } = await readFoundationServerSession();
  const invoice = await readStaffInvoice(api, decodeURIComponent(number));
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
      <InvoiceDocument
        invoice={invoice}
        sellerAddress={invoiceSellerAddress()}
        bank={invoice.status === "issued" ? invoiceBankDetails() : null}
      />
      <PrintButton />
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, FileText } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { formatInvoiceAmount, invoiceStatusLabel } from "@/components/billing/invoice-document";
import {
  FoundationServerSessionError,
  readFoundationServerSession,
} from "@/lib/foundation/server-session";
import { FoundationInvoiceError, readMyInvoices } from "@/lib/foundation/customer-invoices";
import { BILLING_EMAIL } from "@/lib/billing/slot-checkout";
import { formatSaLongDate } from "@/lib/utils/format";
import { createLogger } from "@/lib/utils/logger";
import { logDegradedRead } from "@/lib/utils/request-failure";

export const metadata = { title: "Invoices", robots: { index: false } };
export const dynamic = "force-dynamic";

const log = createLogger("MyInvoicesPage");

/** The member's invoices; null when they cannot be read right now. */
async function myInvoices() {
  try {
    return await readMyInvoices((await readFoundationServerSession()).api);
  } catch (error) {
    if (error instanceof FoundationServerSessionError && error.status === 401)
      redirect(`/login?returnUrl=${encodeURIComponent("/billing/invoices")}`);
    if (
      (error instanceof FoundationServerSessionError || error instanceof FoundationInvoiceError) &&
      error.status !== 503
    )
      throw error;
    logDegradedRead(log, "My invoices unavailable", error);
    return null;
  }
}

export default async function MyInvoicesPage() {
  const invoices = await myInvoices();
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main id="main-content" className="flex-1 scroll-mt-24 bg-background">
        <div className="container-page space-y-6 py-6 sm:py-10">
          <PageHeader
            title="Invoices"
            breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Invoices" }]}
          />
          {invoices === null ? (
            <p
              role="status"
              className="rounded-2xl border border-border p-5 text-sm text-muted-foreground"
            >
              Your invoices cannot be shown right now. Please try again in a few minutes.
            </p>
          ) : invoices.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
              You have no invoices. For a larger order paid by invoice, email{" "}
              <a href={`mailto:${BILLING_EMAIL}`} className="font-medium underline">
                {BILLING_EMAIL}
              </a>
              .
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card">
              {invoices.map((invoice) => {
                const status = invoiceStatusLabel(invoice);
                return (
                  <li key={invoice.invoice_number}>
                    <Link
                      href={`/billing/invoices/${invoice.invoice_number}`}
                      className="flex items-center gap-3 p-4 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <FileText
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-sm font-semibold">
                          {invoice.invoice_number}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {invoice.description} · {formatSaLongDate(invoice.issued_at)}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold tabular-nums">
                          {formatInvoiceAmount(invoice.total_cents)}
                        </span>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </span>
                      <ChevronRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

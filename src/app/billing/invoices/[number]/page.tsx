import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { InvoicePayPanel } from "@/components/billing/invoice-pay-panel";
import {
  FoundationServerSessionError,
  readFoundationServerSession,
} from "@/lib/foundation/server-session";
import { FoundationInvoiceError, readMyInvoice } from "@/lib/foundation/customer-invoices";
import { invoiceBankDetails, invoiceSellerAddress } from "@/lib/billing/invoice-settings";

export const metadata = { title: "Invoice", robots: { index: false } };
export const dynamic = "force-dynamic";

/** The signed-in member's own invoice; anyone else's number is not found. */
async function loadInvoice(number: string) {
  try {
    return await readMyInvoice((await readFoundationServerSession()).api, number);
  } catch (error) {
    if (error instanceof FoundationServerSessionError && error.status === 401)
      redirect(`/login?returnUrl=${encodeURIComponent(`/billing/invoices/${number}`)}`);
    if (error instanceof FoundationInvoiceError && error.status === 404) return null;
    throw error;
  }
}

export default async function InvoicePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  // Next has decoded the segment; anything that is not an invoice number
  // (including malformed escapes) reads as not found.
  const invoice = await loadInvoice(number);
  if (!invoice) notFound();
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main id="main-content" className="flex-1 scroll-mt-24 bg-background">
        <div className="container-page space-y-6 py-6 sm:py-10">
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Invoices", href: "/billing/invoices" },
            ]}
          />
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] print:block">
            <InvoiceDocument
              headingLevel="h1"
              invoice={invoice}
              sellerAddress={invoiceSellerAddress()}
              bank={invoice.status === "issued" ? invoiceBankDetails() : null}
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
            />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

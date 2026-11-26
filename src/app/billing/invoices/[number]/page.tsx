import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { InvoiceWithPayPanel } from "@/components/billing/invoice-with-pay-panel";
import {
  FoundationServerSessionError,
  readFoundationServerSession,
} from "@/lib/foundation/server-session";
import {
  FoundationInvoiceError,
  readMyInvoice,
  readMyInvoiceTransferExpiry,
} from "@/lib/foundation/customer-invoices";
import { readOnlinePaymentMaxCents } from "@/lib/foundation/payment-limits";

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
  const onlineMaxCents = invoice.status === "issued" ? await readOnlinePaymentMaxCents() : null;
  // A bank transfer to this unpaid invoice that nobody confirmed within 14
  // days; the invoice is payable again. The page still shows without it.
  const transferExpiredAt =
    invoice.status === "issued" && !invoice.transfer_waiting
      ? await readMyInvoiceTransferExpiry(
          (await readFoundationServerSession()).api,
          invoice.invoice_number
        ).catch(() => null)
      : null;
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
          <InvoiceWithPayPanel
            invoice={invoice}
            onlineMaxCents={onlineMaxCents}
            transferExpired={transferExpiredAt !== null}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}

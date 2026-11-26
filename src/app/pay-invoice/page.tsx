import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { InvoiceWithPayPanel } from "@/components/billing/invoice-with-pay-panel";
import { readInvoiceByLink } from "@/lib/foundation/customer-invoices";
import { readOnlinePaymentMaxCents } from "@/lib/foundation/payment-limits";
import { BILLING_EMAIL } from "@/lib/billing/slot-checkout";

export const metadata: Metadata = {
  title: "Pay invoice",
  robots: { index: false, follow: false },
  // The payment link's token is in the address; never pass it on to other sites.
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

/** What the page says without an invoice: back from Ozow, or a link that
 * does not work (malformed, unknown, replaced by a newer email, or of an
 * account that can no longer use the site). */
const MESSAGES = {
  back: {
    title: "Thank you",
    text: "Once Ozow confirms the payment, the invoice shows as paid and a receipt is emailed to the account holder. To check, open the payment link in the invoice email again.",
  },
  cancelled: {
    title: "Payment not completed",
    text: "Nothing was paid. To try again, open the payment link in the invoice email.",
  },
  invalid: {
    title: "This payment link has expired or does not work",
    text: `Please ask the account holder to sign in and pay it, or email ${BILLING_EMAIL}.`,
  },
} as const;

/**
 * The invoice email's payment link (update 20261126053701): its payer sees
 * the invoice and pays it without signing in, with the same panel as the
 * member's invoice page. Ozow sends the payer back here (`?ozow=`), without
 * the token.
 */
export default async function PayInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; ozow?: string | string[] }>;
}) {
  const { token, ozow } = await searchParams;
  const invoice = typeof token === "string" ? await readInvoiceByLink(token) : null;
  const message = invoice
    ? null
    : ozow === "back"
      ? MESSAGES.back
      : ozow === "cancelled"
        ? MESSAGES.cancelled
        : MESSAGES.invalid;
  const onlineMaxCents = invoice?.status === "issued" ? await readOnlinePaymentMaxCents() : null;
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1 scroll-mt-24 bg-background">
        {invoice && typeof token === "string" ? (
          <div className="container-page py-6 sm:py-10">
            <InvoiceWithPayPanel
              invoice={invoice}
              onlineMaxCents={onlineMaxCents}
              linkToken={token}
            />
          </div>
        ) : message ? (
          <div className="container-page max-w-2xl space-y-3 py-10 sm:py-16">
            <h1 className="font-display text-2xl font-semibold">{message.title}</h1>
            <p className="text-muted-foreground">{message.text}</p>
          </div>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}

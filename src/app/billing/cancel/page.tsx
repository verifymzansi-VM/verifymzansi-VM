import { AlertCircle, Clock3, CheckCircle2, XCircle } from "lucide-react";
import { PaymentStatusResult } from "@/components/billing/payment-status-result";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { resolveCurrentUserPaymentStatus } from "@/lib/payments/resolve-payment-status";
import type { PaymentStatusView } from "@/lib/payments/status-view";

export const metadata = {
  title: "Payment Status",
  description: "Review the current status of your VerifyMzansi payment.",
};

function getCopy(status: PaymentStatusView) {
  switch (status) {
    case "complete":
      return {
        icon: <CheckCircle2 className="h-6 w-6 text-brand-green" />,
        title: "Payment complete",
        description: "Your payment went through and your plan is now active.",
      };
    case "pending":
      return {
        icon: <Clock3 className="h-6 w-6 text-brand-green" />,
        title: "Payment still processing",
        description:
          "We're still waiting for final confirmation from the payment provider. Check again in 30 seconds or return to billing.",
      };
    case "failed":
      return {
        icon: <XCircle className="h-6 w-6 text-destructive" />,
        title: "Payment not completed",
        description:
          "Your payment was not completed. This could be because you cancelled, or because there was a processing issue. No charge was made.",
      };
    case "expired":
      return {
        icon: <AlertCircle className="h-6 w-6 text-destructive" />,
        title: "Payment expired",
        description: "This checkout session expired. Start a new payment to continue.",
      };
    default:
      return {
        icon: <AlertCircle className="h-6 w-6 text-muted-foreground" />,
        title: "Payment not found",
        description: "We could not resolve a matching payment for this request.",
      };
  }
}

export default async function BillingCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const { payment } = await searchParams;
  const status = await resolveCurrentUserPaymentStatus(payment);
  const copy = getCopy(status);

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main id="main-content" className="flex flex-1 items-center justify-center py-4 scroll-mt-24">
        <PaymentStatusResult
          icon={copy.icon}
          title={copy.title}
          description={copy.description}
          primaryAction={{ href: "/billing", label: "View Plans" }}
          secondaryAction={{ href: "/dashboard", label: "Back to Dashboard" }}
        >
          <p className="text-xs text-muted-foreground">
            Need help? Contact{" "}
            <a
              href="mailto:support@verifymzansi.com"
              className="rounded-sm text-brand-green underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              support@verifymzansi.com
            </a>
          </p>
        </PaymentStatusResult>
      </main>

      <Footer />
    </div>
  );
}

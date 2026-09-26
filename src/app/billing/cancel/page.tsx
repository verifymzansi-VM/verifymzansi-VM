import { AlertCircle, Clock3, CheckCircle2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import {
  PaymentStatusResult,
  type PaymentStatusTone,
} from "@/components/billing/payment-status-result";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { resolveCurrentUserPaymentStatus } from "@/lib/payments/resolve-payment-status";
import type { PaymentStatusView } from "@/lib/payments/status-view";
import { SUPPORT_CONTACT_EMAIL } from "@/lib/contact-email";

export const metadata = {
  title: "Payment Status",
  description: "Review the current status of your VerifyMzansi payment.",
};

function getCopy(status: PaymentStatusView): {
  icon: ReactNode;
  title: string;
  description: string;
  tone: PaymentStatusTone;
} {
  switch (status) {
    case "complete":
      return {
        icon: <CheckCircle2 aria-hidden="true" />,
        title: "Payment complete",
        description: "Your payment went through and your plan is now active.",
        tone: "success",
      };
    case "pending":
      return {
        icon: <Clock3 aria-hidden="true" />,
        title: "Payment still processing",
        description: "We're waiting for Ozow to confirm. Check again in 30 seconds.",
        tone: "pending",
      };
    case "failed":
      return {
        icon: <XCircle aria-hidden="true" />,
        title: "Payment not completed",
        description:
          "The payment was cancelled or didn't go through. No charge was made, so you can try again.",
        tone: "error",
      };
    case "expired":
      return {
        icon: <AlertCircle aria-hidden="true" />,
        title: "Checkout expired",
        description: "This checkout session expired. Start a new payment to continue.",
        tone: "error",
      };
    default:
      return {
        icon: <AlertCircle aria-hidden="true" />,
        title: "Payment not found",
        description:
          "We couldn't find this payment. Check your plans, or contact support if you were charged.",
        tone: "neutral",
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

      <main
        id="main-content"
        className="bg-hero-mesh flex flex-1 scroll-mt-24 items-center justify-center py-10 sm:py-16"
      >
        <PaymentStatusResult
          icon={copy.icon}
          title={copy.title}
          description={copy.description}
          tone={copy.tone}
          primaryAction={
            status === "complete"
              ? { href: "/dashboard", label: "Go to dashboard" }
              : { href: "/billing", label: "View plans" }
          }
          secondaryAction={
            status === "complete"
              ? { href: "/billing", label: "View billing" }
              : { href: "/dashboard", label: "Back to dashboard" }
          }
        >
          <p className="text-xs text-muted-foreground">
            Need help? Contact{" "}
            <a
              href={`mailto:${SUPPORT_CONTACT_EMAIL}`}
              className="rounded-sm font-medium text-brand-green-700 underline dark:text-brand-green-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {SUPPORT_CONTACT_EMAIL}
            </a>
          </p>
        </PaymentStatusResult>
      </main>

      <Footer />
    </div>
  );
}

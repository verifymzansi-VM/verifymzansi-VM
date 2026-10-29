import type { PaymentStatusView } from "./status-view";

/** Shared wording for both provider return pages; existing layout is retained. */
export function paymentExceptionCopy(status: PaymentStatusView) {
  switch (status) {
    case "needs_reconciliation":
      return {
        title: "Payment received — activation needs review",
        description:
          "Your payment was received, but the paid features have not been activated. Contact support with your payment reference before paying again.",
        tone: "neutral" as const,
      };
    case "refunded":
      return {
        title: "Payment refunded",
        description:
          "This payment has been recorded as refunded. The paid access it funded has been withdrawn. Contact support if you need help with the refund.",
        tone: "neutral" as const,
      };
    case "chargeback":
      return {
        title: "Payment reversed",
        description:
          "This payment has been reversed and the paid access it funded has been withdrawn. Contact support if you need help.",
        tone: "neutral" as const,
      };
    case "cancelled":
      return {
        title: "Checkout cancelled",
        description:
          "This checkout is cancelled and no paid access was activated. If money left your account, contact support with your payment reference before paying again.",
        tone: "neutral" as const,
      };
    default:
      return null;
  }
}

import { normalizePaymentStatus } from "@/lib/utils/enum-compat";

export type PaymentStatusView =
  | "complete"
  | "pending"
  | "failed"
  | "expired"
  | "missing"
  | "needs_reconciliation"
  | "refunded"
  | "chargeback"
  | "cancelled";

/** Receiving funds and granting access are separate facts. Never infer the
 * latter from the payment status alone on the foundation backend. */
export function toFoundationPaymentStatusView(
  payment: { status: string; fulfillment_status: string } | null | undefined
): PaymentStatusView {
  if (!payment) return "missing";
  if (payment.status === "complete")
    return payment.fulfillment_status === "fulfilled" ? "complete" : "needs_reconciliation";
  if (["refunded", "chargeback", "cancelled"].includes(payment.status))
    return payment.status as "refunded" | "chargeback" | "cancelled";
  return toPaymentStatusView(payment.status);
}

export function toPaymentStatusView(status?: string | null): PaymentStatusView {
  switch (normalizePaymentStatus(status ?? "")) {
    case "complete":
      return "complete";
    case "pending":
    case "processing":
      return "pending";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    default:
      return "missing";
  }
}

export function isTerminalPaymentStatusView(status: PaymentStatusView): boolean {
  return status !== "pending";
}

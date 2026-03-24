import { normalizePaymentStatus } from "@/lib/utils/enum-compat";

export type PaymentStatusView = "complete" | "pending" | "failed" | "expired" | "missing";

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

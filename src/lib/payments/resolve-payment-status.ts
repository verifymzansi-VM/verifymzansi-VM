import "server-only";
import {
  readFoundationServerSession,
  FoundationServerSessionError,
} from "@/lib/foundation/server-session";
import { readFoundationPayment } from "@/lib/foundation/billing-runtime";
import { toFoundationPaymentStatusView, type PaymentStatusView } from "@/lib/payments/status-view";

export async function resolveCurrentUserPaymentStatus(
  paymentId?: string
): Promise<PaymentStatusView> {
  if (!paymentId) {
    return "missing";
  }
  if (!/^[a-f0-9-]{36}$/i.test(paymentId)) return "missing";
  try {
    const current = await readFoundationServerSession();
    const payment = await readFoundationPayment(current.api, paymentId);
    return toFoundationPaymentStatusView(payment);
  } catch (error) {
    return error instanceof FoundationServerSessionError && error.status === 401
      ? "missing"
      : "pending";
  }
}

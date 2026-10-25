import "server-only";
import { getDataBackend } from "@/lib/data-backend";
import {
  readFoundationServerSession,
  FoundationServerSessionError,
} from "@/lib/foundation/server-session";
import { readFoundationPayment } from "@/lib/foundation/billing-runtime";

import { createClient } from "@/lib/supabase/server";
import { toPaymentStatusView, type PaymentStatusView } from "@/lib/payments/status-view";

export async function resolveCurrentUserPaymentStatus(
  paymentId?: string
): Promise<PaymentStatusView> {
  if (!paymentId) {
    return "missing";
  }
  if (getDataBackend() === "foundation") {
    if (!/^[a-f0-9-]{36}$/i.test(paymentId)) return "missing";
    try {
      const current = await readFoundationServerSession();
      const payment = await readFoundationPayment(current.api, paymentId);
      return toPaymentStatusView(
        payment?.status === "cancelled" ||
          payment?.status === "refunded" ||
          payment?.status === "chargeback"
          ? "failed"
          : payment?.status
      );
    } catch (error) {
      return error instanceof FoundationServerSessionError && error.status === 401
        ? "missing"
        : "pending";
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return "missing";
  }

  const { data: payment, error } = await supabase
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .eq("user_id", user.id)
    .maybeSingle();

  // A transient query failure must not be reported as "missing" (terminal) —
  // surface "pending" so polling UIs keep retrying until the read recovers.
  if (error) {
    return "pending";
  }

  return toPaymentStatusView(payment?.status);
}

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { toPaymentStatusView, type PaymentStatusView } from "@/lib/payments/status-view";

export async function resolveCurrentUserPaymentStatus(
  paymentId?: string
): Promise<PaymentStatusView> {
  if (!paymentId) {
    return "missing";
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return "missing";
  }

  const { data: payment } = await supabase
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .eq("user_id", user.id)
    .maybeSingle();

  return toPaymentStatusView(payment?.status);
}

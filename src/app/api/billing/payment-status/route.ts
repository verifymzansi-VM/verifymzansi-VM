import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isTerminalPaymentStatusView, toPaymentStatusView } from "@/lib/payments/status-view";
import { parseAndValidateSearchParams } from "@/lib/utils/api";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { optionalUuidSchema } from "@/lib/validations/shared";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileOzowPayment } from "@/lib/payments/reconciliation";
import { createLogger } from "@/lib/utils/logger";
import type { PaymentRecordShape } from "@/lib/payments/types";

const paymentStatusQuerySchema = z.object({
  payment: optionalUuidSchema,
});

// This endpoint is polled by the billing success page every few seconds, so
// the per-user local limit is lenient while still stopping abusive loops.
const PAYMENT_STATUS_RATE_LIMIT_PER_MINUTE = 60;

export async function GET(request: NextRequest) {
  const parsedQuery = parseAndValidateSearchParams(
    request.nextUrl.searchParams,
    paymentStatusQuerySchema,
    {
      validationErrorMessage: "Invalid payment status query",
      includeValidationDetails: false,
    }
  );
  if (!parsedQuery.success) {
    return parsedQuery.response;
  }

  const paymentId = parsedQuery.data.payment;

  if (!paymentId) {
    return NextResponse.json(
      { status: "missing", terminal: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = checkLocalRateLimit(
    user.id,
    "billing:payment-status:read",
    PAYMENT_STATUS_RATE_LIMIT_PER_MINUTE
  );
  if (rl.limited) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter ?? 60), "Cache-Control": "no-store" },
      }
    );
  }

  const { data: initialPayment, error: paymentError } = await supabase
    .from("payments")
    .select(
      "id,user_id,area,amount_cents,status,provider,provider_payment_id,provider_reference,provider_data,created_at"
    )
    .eq("id", paymentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (paymentError) {
    return NextResponse.json(
      { error: "Unable to check payment status" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Missing payment row — terminal immediately, no point polling
  if (!initialPayment) {
    return NextResponse.json(
      { status: "missing", terminal: true, expired: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  let payment = initialPayment;
  if (
    ["pending", "failed", "expired"].includes(payment.status) &&
    payment.provider === "ozow" &&
    payment.provider_payment_id
  ) {
    try {
      await reconcileOzowPayment(payment as PaymentRecordShape, createAdminClient());
      const { data: refreshed, error } = await supabase
        .from("payments")
        .select("status, created_at")
        .eq("id", paymentId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw new Error("Unable to reload payment status");
      if (refreshed) payment = { ...payment, ...refreshed };
    } catch (error) {
      createLogger("PaymentStatus").warn("Ozow status reconciliation unavailable", {
        paymentId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      // Preserve the stored status during a provider outage; never infer unpaid.
    }
  }
  const status = toPaymentStatusView(payment.status);
  const isTerminal = isTerminalPaymentStatusView(status);

  const isExpired = status === "expired";

  return NextResponse.json(
    {
      status: isExpired ? "expired" : status,
      terminal: isTerminal || isExpired,
      expired: isExpired,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

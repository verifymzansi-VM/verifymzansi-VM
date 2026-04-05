import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isTerminalPaymentStatusView, toPaymentStatusView } from "@/lib/payments/status-view";
import { parseAndValidateSearchParams } from "@/lib/utils/api";
import { optionalTrimmedStringSchema } from "@/lib/validations/shared";
import { z } from "zod";

const paymentStatusQuerySchema = z.object({
  payment: optionalTrimmedStringSchema,
});

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

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("status, created_at")
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
  if (!payment) {
    return NextResponse.json(
      { status: "missing", terminal: true, expired: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const status = toPaymentStatusView(payment.status);
  const isTerminal = isTerminalPaymentStatusView(status);

  // Treat payments older than 30 minutes as expired to prevent infinite polling
  const PAYMENT_EXPIRY_MS = 30 * 60 * 1000;
  const createdAt = payment.created_at ? new Date(payment.created_at).getTime() : 0;
  const isExpired = !isTerminal && createdAt > 0 && Date.now() - createdAt > PAYMENT_EXPIRY_MS;

  return NextResponse.json(
    {
      status: isExpired ? "expired" : status,
      terminal: isTerminal || isExpired,
      expired: isExpired,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

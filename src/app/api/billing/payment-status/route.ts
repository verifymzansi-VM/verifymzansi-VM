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

  const { data: payment } = await supabase
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .eq("user_id", user.id)
    .maybeSingle();

  const status = toPaymentStatusView(payment?.status);

  return NextResponse.json(
    { status, terminal: isTerminalPaymentStatusView(status) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  paymentCheckFailureReason,
  runFoundationPaymentReconciliation,
} from "@/lib/foundation/billing-runtime";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("OzowReconciliation");

export async function POST(request: Request) {
  const secret = process.env.INTERNAL_JOBS_SECRET;
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  const received = Buffer.from(request.headers.get("authorization") || "");
  if (!secret || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Per-payment failures are logged with their payment number and reason
    // and listed in `errors` (payment numbers and reason codes only).
    const result = await runFoundationPaymentReconciliation();
    return NextResponse.json(result, {
      status: result.failures ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    log.error("Payment status job failed", { reason: paymentCheckFailureReason(error) });
    return NextResponse.json({ error: "Payment reconciliation unavailable" }, { status: 503 });
  }
}

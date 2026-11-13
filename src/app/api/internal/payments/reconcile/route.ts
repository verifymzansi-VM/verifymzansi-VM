import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  paymentCheckFailureReason,
  runFoundationPaymentReconciliation,
} from "@/lib/foundation/billing-runtime";
import { runOzowRefundJobs } from "@/lib/foundation/ozow-refunds";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import {
  createOzowRefundClient,
  ozowApiRefundsEnabled,
  ozowRefundKeyConfigured,
} from "@/lib/payments/ozow-refunds";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("OzowReconciliation");

/** Refunds through Ozow (null while the refund key is not set): approved
 * refunds whose own send did not happen and unknown sends due a retry with the
 * same Idempotency-Key (only while switched on), and refunds without a final
 * answer read back from Ozow (also while switched off). Never throws: a failure is logged and counted. */
async function runRefundJobs() {
  // Reading refunds back needs only the refund key; sending needs the switch.
  if (!ozowRefundKeyConfigured()) return null;
  try {
    return await runOzowRefundJobs(
      createFoundationServiceApi(),
      createOzowRefundClient(),
      undefined,
      ozowApiRefundsEnabled()
    );
  } catch (error) {
    log.error("Ozow refund jobs failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return { attempted: 0, checked: 0, failures: 1 };
  }
}

export async function POST(request: Request) {
  const secret = process.env.INTERNAL_JOBS_SECRET;
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  const received = Buffer.from(request.headers.get("authorization") || "");
  if (!secret || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let result: Awaited<ReturnType<typeof runFoundationPaymentReconciliation>>;
  try {
    // Per-payment failures are logged with their payment number and reason
    // and listed in `errors` (payment numbers and reason codes only).
    result = await runFoundationPaymentReconciliation();
  } catch (error) {
    log.error("Payment status job failed", { reason: paymentCheckFailureReason(error) });
    // Refunds still go out and are still followed when the payment check fails.
    await runRefundJobs();
    return NextResponse.json({ error: "Payment reconciliation unavailable" }, { status: 503 });
  }
  const refunds = await runRefundJobs();
  // While API refunds are off the answer is exactly as before.
  return NextResponse.json(refunds ? { ...result, refundJobs: refunds } : result, {
    status: result.failures || refunds?.failures ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runOzowRefundReconciliation } from "@/lib/foundation/ozow-refunds";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { createOzowRefundClient, ozowRefundKeyConfigured } from "@/lib/payments/ozow-refunds";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("OzowRefundCheck");

/**
 * POST /api/internal/payments/refunds/reconcile — the daily refund check, run
 * by the payment-cleanup Worker's daily schedule with the job credential. It
 * only reads Ozow's refund list (the last three days) and lets the database
 * raise staff alerts: an Ozow refund with no record of ours, a record whose
 * transaction or amount differs, an API refund stuck for more than a day. It
 * never sends, cancels or changes a refund. It runs whenever the refund key is
 * set (also while sending is switched off), and does nothing without it.
 */
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_JOBS_SECRET;
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  const received = Buffer.from(request.headers.get("authorization") || "");
  if (!secret || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ozowRefundKeyConfigured())
    return NextResponse.json(
      { skipped: "ozow_refund_key_not_set" },
      { headers: { "Cache-Control": "no-store" } }
    );
  try {
    const result = await runOzowRefundReconciliation(
      createFoundationServiceApi(),
      createOzowRefundClient()
    );
    log.info("Ozow refund check finished", result);
    // A list that could not be read (or had entries this site cannot read)
    // fails the run, so the Worker records it; the stuck check still ran.
    return NextResponse.json(result, {
      status: result.listed && result.unreadable === 0 ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    log.error("Ozow refund check failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Refund check unavailable" }, { status: 503 });
  }
}

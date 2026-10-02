import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileOzowPayment } from "@/lib/payments/reconciliation";
import type { PaymentRecordShape } from "@/lib/payments/types";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("OzowReconciliation");

export async function POST(request: Request) {
  // Companion worker WORKER_API_KEY already matches the app's rate limiter key.
  const secret = process.env.RATE_LIMITER_API_KEY;
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  const received = Buffer.from(request.headers.get("authorization") || "");
  if (!secret || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  // Small rotating batch; last-check ordering prevents pending bank transactions
  // from starving other rows. Failed/expired rows recover missed late successes.
  const { data, error } = await admin
    .from("payments")
    .select(
      "id,user_id,area,amount_cents,status,provider,provider_payment_id,provider_reference,provider_data,created_at"
    )
    .eq("provider", "ozow")
    .in("status", ["pending", "failed", "expired"])
    .not("provider_payment_id", "is", null)
    .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order("provider_data->>reconciliation_checked_at", { ascending: true, nullsFirst: true })
    .limit(10);
  if (error)
    return NextResponse.json({ error: "Payment reconciliation unavailable" }, { status: 503 });
  const results = await Promise.allSettled(
    (data || []).map((payment) => reconcileOzowPayment(payment as PaymentRecordShape, admin))
  );
  const failures = results.filter((result) => result.status === "rejected");
  for (const failure of failures) {
    if (failure.status === "rejected")
      log.error("Payment reconciliation failed", {
        error: failure.reason instanceof Error ? failure.reason.message : "Unknown error",
      });
  }
  return NextResponse.json(
    { checked: results.length - failures.length, failures: failures.length },
    { status: failures.length ? 503 : 200, headers: { "Cache-Control": "no-store" } }
  );
}

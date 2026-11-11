import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runFoundationPaymentReconciliation } from "@/lib/foundation/billing-runtime";

export async function POST(request: Request) {
  const secret = process.env.INTERNAL_JOBS_SECRET;
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  const received = Buffer.from(request.headers.get("authorization") || "");
  if (!secret || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runFoundationPaymentReconciliation();
    return NextResponse.json(result, {
      status: result.failures ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Payment reconciliation unavailable" }, { status: 503 });
  }
}

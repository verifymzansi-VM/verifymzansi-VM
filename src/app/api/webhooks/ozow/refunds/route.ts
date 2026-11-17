import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { applyOzowRefundFact } from "@/lib/foundation/ozow-refunds";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { readOzowSignatureHeaders, verifyOzowSignature } from "@/lib/payments/ozow";
import {
  createOzowRefundClient,
  ozowApiRefundsEnabled,
  ozowRefundWebhookSecret,
} from "@/lib/payments/ozow-refunds";
import { recordSecurityEvent, securityContext } from "@/lib/security/security-events";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/utils/request-body";

const log = createLogger("OzowRefundWebhook");
const noStore = { "Cache-Control": "no-store" };

/**
 * POST /api/webhooks/ozow/refunds — Ozow's signed `refund.complete` notices.
 *
 * - Only while API refunds are on (OZOW_API_REFUNDS_ENABLED) and the refund
 *   webhook's own secret is set (OZOW_REFUND_WEBHOOK_SECRET); otherwise 503.
 * - The Svix signature (svix-id, svix-timestamp within five minutes,
 *   svix-signature) is checked over the raw body before anything is read; an
 *   unsigned or wrongly signed notice is refused with 401 and logged.
 * - The notice only names a refund. Its transaction, amount and status are
 *   read back from Ozow (GET /v1/refunds/{id}) and that answer is applied, so
 *   a replayed or altered notice can never set a status Ozow does not report.
 * - Applying is idempotent in the database (the same status twice changes
 *   nothing); Ozow lookup or database outages answer 5xx so Ozow retries.
 */

const envelope = z.looseObject({
  type: z.string().optional(),
  event_type: z.string().optional(),
  eventType: z.string().optional(),
  data: z.looseObject({}).optional(),
});
const refundId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform((value) => value.toLowerCase());

export async function POST(request: NextRequest) {
  const secret = ozowRefundWebhookSecret();
  if (!ozowApiRefundsEnabled() || !secret)
    return NextResponse.json(
      { error: "Ozow refund notices are not enabled" },
      { status: 503, headers: noStore }
    );
  try {
    const limit = await checkRateLimit({
      key: getClientIp(request),
      action: "webhook:ozow-refunds",
      degradedMode: "local",
    });
    if (limit.limited)
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } }
      );
    let rawBody: string;
    try {
      rawBody = await readBoundedRequestText(request, 64 * 1024);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError)
        return NextResponse.json({ error: "Payload too large" }, { status: 413 });
      throw error;
    }
    if (
      !readOzowSignatureHeaders(request.headers) ||
      !verifyOzowSignature(rawBody, request.headers, secret)
    ) {
      log.warn("Invalid Ozow refund notice signature");
      recordSecurityEvent({
        event: "payment.callback_rejected",
        ...securityContext(request),
        reason: "invalid_signature",
      });
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
    let parsed: z.infer<typeof envelope>;
    try {
      parsed = envelope.parse(JSON.parse(rawBody));
    } catch {
      // Correctly signed but unreadable: acknowledged so it is not retried for
      // a day; the daily check still compares Ozow's refund list.
      log.error("Signed Ozow refund notice could not be read");
      return NextResponse.json({ success: true, rejected: "invalid_json" }, { headers: noStore });
    }
    const type = (parsed.type ?? parsed.event_type ?? parsed.eventType ?? "").toLowerCase();
    if (type !== "refund.complete")
      return NextResponse.json({ success: true, ignored: true }, { headers: noStore });
    const id = refundId.safeParse(parsed.data?.id ?? parsed.data?.RefundId);
    if (!id.success) {
      log.error("Signed Ozow refund notice named no refund");
      return NextResponse.json(
        { success: true, rejected: "missing_refund_id" },
        { headers: noStore }
      );
    }
    // Ozow's own record, never the notice's body, decides what is applied.
    const fact = await createOzowRefundClient().get(id.data);
    const result = await applyOzowRefundFact(createFoundationServiceApi(), fact, "refund_notice");
    log.info("Ozow refund notice applied", { refundId: fact.refundId, outcome: result.outcome });
    return NextResponse.json({ success: true, outcome: result.outcome }, { headers: noStore });
  } catch (error) {
    log.error("Ozow refund notice processing failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 503, headers: { "Retry-After": "30", ...noStore } }
    );
  }
}

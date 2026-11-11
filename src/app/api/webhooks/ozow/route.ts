import { NextResponse, type NextRequest } from "next/server";
import { applyFoundationOzowNotification } from "@/lib/foundation/billing-runtime";
import { createLogger } from "@/lib/utils/logger";
import {
  getOzowTransaction,
  normalizeOzowWebhook,
  verifyOzowWebhookSignature,
} from "@/lib/payments/ozow";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/utils/request-body";
import { recordSecurityEvent, securityContext } from "@/lib/security/security-events";

const log = createLogger("OzowWebhook");
const SUPPORTED_OZOW_EVENT_TYPE = "transaction.complete";

/**
 * Route ownership:
 * - Authenticity: rate limit, body size, webhook secret and Ozow signature checks.
 * - Shape: normalized Ozow payload, merchant reference and transaction status.
 * - Validation, idempotency, fulfillment and notifications: the foundation
 *   payment runtime (applyFoundationOzowNotification).
 */

function isE2eLoggingContext(): boolean {
  const runtimeMode = (process.env.VERIFYMZANSI_RUNTIME_MODE || "").toLowerCase();
  return (
    runtimeMode === "e2e" ||
    runtimeMode === "playwright" ||
    runtimeMode === "test" ||
    process.env.PLAYWRIGHT_E2E_AUTH === "1"
  );
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit webhook by IP to prevent flood attacks
    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "webhook:ozow",
      degradedMode: "local",
    });
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    let rawBody: string;
    try {
      rawBody = await readBoundedRequestText(request, 256 * 1024);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ error: "Payload too large" }, { status: 413 });
      }
      throw error;
    }
    const webhookSecret = process.env.OZOW_WEBHOOK_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    if (!webhookSecret) {
      if (isProduction) {
        return NextResponse.json(
          { error: "Ozow webhook temporarily unavailable" },
          { status: 503 }
        );
      }
      log.warn("OZOW_WEBHOOK_SECRET is not set — rejecting unsigned webhook in non-production");
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
    }

    if (!verifyOzowWebhookSignature(rawBody, request.headers)) {
      if (isE2eLoggingContext()) {
        log.info("Invalid Ozow webhook signature");
      } else {
        log.warn("Invalid Ozow webhook signature");
      }
      recordSecurityEvent({
        event: "payment.callback_rejected",
        ...securityContext(request),
        reason: "invalid_signature",
      });
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch (error) {
      log.warn("Ozow webhook JSON parse failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    let payload = normalizeOzowWebhook(parsedBody);
    if (payload?.eventType?.toLowerCase() !== SUPPORTED_OZOW_EVENT_TYPE) {
      return NextResponse.json({ success: true, ignored: true });
    }
    if (payload.format === "thin" && payload.transactionId) {
      // Fetch authoritative reference, site, amount and current status. A lookup
      // failure returns 5xx so Svix retries rather than losing the completion.
      const thinPayload = payload.rawPayload;
      payload = await getOzowTransaction(payload.transactionId);
      payload.rawPayload = { ...thinPayload, resolvedTransaction: payload.rawPayload };
    }
    if (!payload?.merchantReference) {
      return NextResponse.json({ error: "Missing merchantReference" }, { status: 400 });
    }
    if (payload.eventType?.toLowerCase() === SUPPORTED_OZOW_EVENT_TYPE && !payload.status) {
      return NextResponse.json({ error: "Missing transaction status" }, { status: 400 });
    }

    return NextResponse.json(await applyFoundationOzowNotification(payload, rawBody));
  } catch (error) {
    log.error("Ozow webhook processing failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500, headers: { "Retry-After": "30" } }
    );
  }
}

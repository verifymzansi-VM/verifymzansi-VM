import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationServiceApi } from "./service-api";
import { diditConfig, DiditError } from "./didit-client";
import { recordIdentityCheckResult } from "./identity-check-result";
import { checkRateLimit, getClientIp } from "../utils/rate-limit";
import { readBoundedRequestText, RequestBodyTooLargeError } from "../utils/request-body";
import { createLogger } from "../utils/logger";

const log = createLogger("DiditWebhook");

/** Didit's recommended window for X-Timestamp, in seconds. */
export const DIDIT_WEBHOOK_WINDOW_S = 300;

/**
 * True when the body carries Didit's signature: X-Signature, the HMAC-SHA256
 * (hex) of the exact body with DIDIT_WEBHOOK_SECRET, or X-Signature-Previous
 * during the 24 hours after a secret rotation; and X-Timestamp within five
 * minutes of now.
 */
export function verifyDiditWebhookSignature(
  body: string,
  headers: Pick<Headers, "get">,
  secret: string | undefined,
  nowMs = Date.now()
) {
  if (!secret) return false;
  const timestamp = Number(headers.get("x-timestamp"));
  if (!Number.isInteger(timestamp) || Math.abs(nowMs / 1000 - timestamp) > DIDIT_WEBHOOK_WINDOW_S)
    return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(body, "utf8").digest("hex"));
  return [headers.get("x-signature"), headers.get("x-signature-previous")].some((value) => {
    const given = Buffer.from((value ?? "").trim().toLowerCase());
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const event = z.object({ session_id: z.uuid(), webhook_type: z.string() });

/** The delivery's exact body, after the rate limit and size limit, or the
 * answer to send instead. */
export async function readDiditWebhook(request: NextRequest): Promise<string | NextResponse> {
  const limited = await checkRateLimit({
    key: getClientIp(request),
    action: "webhook:didit",
    degradedMode: "local",
  });
  if (limited.limited) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    return await readBoundedRequestText(request, 1024 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    throw error;
  }
}

/**
 * A signed delivery. A status change only tells the server to look at the
 * session again: the result is fetched from Didit and recorded once
 * (api.complete_identity_check), so a repeated or reordered delivery changes
 * nothing. Answers 503 when the result could not be recorded, so Didit
 * delivers again.
 */
export async function handleSignedDiditWebhook(body: string) {
  let parsed: z.infer<typeof event> | null = null;
  try {
    parsed = event.parse(JSON.parse(body));
  } catch {
    parsed = null;
  }
  // Other events (data edits, users, transactions) need nothing from us.
  if (!parsed || parsed.webhook_type !== "status.updated")
    return NextResponse.json({ ignored: true });
  const config = diditConfig();
  if (!config) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  try {
    const result = await recordIdentityCheckResult(
      createFoundationServiceApi(),
      config,
      parsed.session_id
    );
    return NextResponse.json(result);
  } catch (error) {
    log.error("Identity check result was not recorded", {
      error:
        error instanceof DiditError
          ? `didit_${error.reason}`
          : error instanceof Error
            ? error.name
            : "unknown",
    });
    return NextResponse.json({ error: "Try again later" }, { status: 503 });
  }
}

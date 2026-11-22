import { NextResponse, type NextRequest } from "next/server";
import {
  handleSignedDiditWebhook,
  readDiditWebhook,
  verifyDiditWebhookSignature,
} from "@/lib/foundation/didit-webhook";

/**
 * POST /api/webhooks/didit: the automatic ID check partner's status changes,
 * signed with DIDIT_WEBHOOK_SECRET (src/lib/foundation/didit-webhook.ts). An
 * unsigned or stale delivery is answered 400, which Didit does not retry.
 */
export async function POST(request: NextRequest) {
  const body = await readDiditWebhook(request);
  if (typeof body !== "string") return body;
  if (!verifyDiditWebhookSignature(body, request.headers, process.env.DIDIT_WEBHOOK_SECRET))
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  return handleSignedDiditWebhook(body);
}

import { NextResponse, type NextRequest } from "next/server";
import {
  handleSignedDiditWebhook,
  readDiditWebhook,
  verifyDiditWebhookSignature,
} from "@/lib/foundation/didit-webhook";

/**
 * POST /api/webhooks/didit: the automatic ID check partner's status changes,
 * signed with DIDIT_WEBHOOK_SECRET (src/lib/foundation/didit-webhook.ts).
 */
export async function POST(request: NextRequest) {
  const body = await readDiditWebhook(request);
  if (typeof body !== "string") return body;
  if (!verifyDiditWebhookSignature(body, request.headers, process.env.DIDIT_WEBHOOK_SECRET))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return handleSignedDiditWebhook(body);
}

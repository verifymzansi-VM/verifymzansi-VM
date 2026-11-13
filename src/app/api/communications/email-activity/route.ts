import type { NextRequest } from "next/server";
import { handleRestoredEmailActivity } from "@/lib/foundation/restored-communication-route";

/**
 * GET /api/communications/email-activity
 * The signed-in member's own recent account emails: sent or failed, and when.
 */
export async function GET(request: NextRequest) {
  return handleRestoredEmailActivity(request);
}

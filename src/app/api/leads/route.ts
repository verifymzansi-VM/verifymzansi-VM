import type { NextRequest } from "next/server";
import { handleRestoredInbox } from "@/lib/foundation/restored-inbox-route";

/**
 * GET /api/leads
 * Fetch the authenticated user's leads and unread lead count.
 */
export async function GET(request: NextRequest) {
  return handleRestoredInbox(request, false);
}

/**
 * PATCH /api/leads
 * Update a lead status for the authenticated owner.
 */
export async function PATCH(request: NextRequest) {
  return handleRestoredInbox(request, true);
}

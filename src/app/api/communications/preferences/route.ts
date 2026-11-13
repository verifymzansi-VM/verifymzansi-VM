import type { NextRequest } from "next/server";
import { handleRestoredCommunicationPreferences } from "@/lib/foundation/restored-communication-route";

/**
 * GET /api/communications/preferences
 * The signed-in member's optional communication choices (all off until the
 * member turns one on).
 */
export async function GET(request: NextRequest) {
  return handleRestoredCommunicationPreferences(request, "GET");
}

/**
 * PATCH /api/communications/preferences
 * Body: one or more of { marketing_email, marketing_sms, analytics,
 * third_party_sharing } as booleans. Each change is recorded with the time
 * and the wording the member saw.
 */
export async function PATCH(request: NextRequest) {
  return handleRestoredCommunicationPreferences(request, "PATCH");
}

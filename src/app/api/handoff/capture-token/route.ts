import { type NextRequest } from "next/server";
import { handlePhoneCaptureToken } from "@/lib/foundation/capture-handoff-routes";

/**
 * POST /api/handoff/capture-token
 *
 * The phone page (signed in as the link's owner) asks for a capture token when
 * its camera starts; bound to the phone's capture grant.
 */
export async function POST(request: NextRequest) {
  return handlePhoneCaptureToken(request);
}

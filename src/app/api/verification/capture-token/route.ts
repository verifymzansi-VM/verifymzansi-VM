import { type NextRequest } from "next/server";
import { handleMemberCaptureToken } from "@/lib/foundation/capture-token-routes";

/**
 * POST /api/verification/capture-token
 *
 * The verification page asks for a capture token when its camera starts; the
 * photo must be sent within 10 minutes of it, from the same sign-in session.
 */
export async function POST(request: NextRequest) {
  return handleMemberCaptureToken(request);
}

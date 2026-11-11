/**
 * POST /api/verification/session/start
 * Starts or resumes a verification session and returns step requirements.
 */

import { type NextRequest } from "next/server";
import { handleRestoredVerificationSession } from "@/lib/foundation/restored-verification-route";

export async function POST(request: NextRequest) {
  return handleRestoredVerificationSession(request);
}

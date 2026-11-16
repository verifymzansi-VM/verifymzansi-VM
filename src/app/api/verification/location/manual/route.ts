/**
 * POST /api/verification/location/manual
 * Accepts a manually selected province + city and writes the location verification step.
 */

import { type NextRequest } from "next/server";
import { handleRestoredVerification } from "@/lib/foundation/restored-verification-route";

export async function POST(request: NextRequest) {
  return handleRestoredVerification(request, true);
}

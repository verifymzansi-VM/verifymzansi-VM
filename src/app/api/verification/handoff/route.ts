import { type NextRequest } from "next/server";
import { handleStartCaptureHandoff } from "@/lib/foundation/capture-handoff-routes";

/**
 * POST /api/verification/handoff
 *
 * The signed-in computer asks for a "Continue on your phone" link: single use,
 * 15 minutes, only for this account and its open identity case. Answers a QR
 * code drawn on the server; the link's token is never stored (SHA-256 only).
 */
export async function POST(request: NextRequest) {
  return handleStartCaptureHandoff(request);
}

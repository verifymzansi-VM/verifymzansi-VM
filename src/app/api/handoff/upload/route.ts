import { type NextRequest } from "next/server";
import { handleCaptureHandoffUpload } from "@/lib/foundation/capture-handoff-routes";

/**
 * POST /api/handoff/upload
 *
 * The phone sends an ID photo or selfie taken with the camera on the page, for
 * the case of the link it opened. Multipart: file, docType, uploadRequestId,
 * captureMethod ("camera") and, for the selfie, livenessPassed.
 */
export async function POST(request: NextRequest) {
  return handleCaptureHandoffUpload(request);
}

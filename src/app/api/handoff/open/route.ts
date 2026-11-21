import { type NextRequest } from "next/server";
import { handleOpenCaptureHandoff } from "@/lib/foundation/capture-handoff-routes";

/**
 * POST /api/handoff/open
 *
 * The phone opens a "Continue on your phone" link once. It gets a capture
 * grant (HttpOnly cookie) that only lets it take the photos for that case.
 */
export async function POST(request: NextRequest) {
  return handleOpenCaptureHandoff(request);
}

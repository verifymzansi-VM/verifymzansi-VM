import { type NextRequest } from "next/server";
import { handleCaptureHandoffState } from "@/lib/foundation/capture-handoff-routes";

/** GET /api/handoff/state: which photos the phone still needs to take. */
export async function GET(request: NextRequest) {
  return handleCaptureHandoffState(request);
}

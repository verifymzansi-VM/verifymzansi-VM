import { NextRequest } from "next/server";
import { handleRestoredPostAction } from "@/lib/foundation/restored-post-actions";

/**
 * POST /api/content/lifecycle
 * Owner slot actions: mark sold / deactivate (frees the posting slot) and
 * reactivate saved content (uses a slot; unchanged approved content goes
 * straight back live). The foundation post actions apply every rule.
 */
export async function POST(request: Request) {
  return handleRestoredPostAction(new NextRequest(request), "lifecycle");
}

import { NextRequest } from "next/server";
import { handleRestoredPostAction } from "@/lib/foundation/restored-post-actions";

/**
 * POST /api/content/resubmit
 * Allows the account holder to resubmit rejected content for moderation after editing.
 */
export async function POST(request: Request) {
  return handleRestoredPostAction(new NextRequest(request), "resubmit");
}

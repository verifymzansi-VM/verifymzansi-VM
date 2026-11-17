import type { NextRequest } from "next/server";
import { handleRestoredPostAction } from "@/lib/foundation/restored-post-actions";

/**
 * POST /api/content/delete
 * Allows the account holder to permanently delete their own content.
 */
export async function POST(request: NextRequest) {
  return handleRestoredPostAction(request, "delete");
}

import type { NextRequest } from "next/server";
import { handleRestoredModerationDecision } from "@/lib/foundation/restored-moderation-route";

/**
 * POST /api/admin/content/decide
 * Approve or reject content pending moderation.
 */
export async function POST(request: NextRequest) {
  return handleRestoredModerationDecision(request, false);
}

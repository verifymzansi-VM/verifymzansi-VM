import type { NextRequest } from "next/server";
import { handleRestoredModerationDecision } from "@/lib/foundation/restored-moderation-route";

export async function POST(request: NextRequest) {
  return handleRestoredModerationDecision(request, true);
}

import { NextRequest } from "next/server";
import { handleRestoredModerationDecision } from "@/lib/foundation/restored-moderation-route";

export async function POST(request: Request) {
  return handleRestoredModerationDecision(new NextRequest(request), true);
}

import { NextRequest } from "next/server";
import { handleRestoredQueueAction } from "@/lib/foundation/restored-queue-route";

/**
 * POST /api/admin/queue
 *
 * claim the next items from a queue, renew your claims, release them, or (as
 * a governor or admin) free or reassign someone else's claim.
 */
export async function POST(request: Request) {
  return handleRestoredQueueAction(new NextRequest(request));
}

import { type NextRequest } from "next/server";

import { sendSeenOwnerMessage } from "@/lib/foundation/seen-media-route";

/**
 * POST /api/businesses/[id]/verification/messages
 * The owner replies to staff, optionally with a new document. A new CIPC
 * document is re-read and replaces the evidence staff compare; the case goes
 * back to the review queue.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return sendSeenOwnerMessage(request, (await params).id);
}

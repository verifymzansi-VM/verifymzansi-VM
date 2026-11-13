import { type NextRequest } from "next/server";

import { handleNativeCipcOwnerAction } from "@/lib/foundation/cipc-commands";

/**
 * POST /api/businesses/[id]/verification/route-switch
 * An owner who isn't a director moves their open CIPC request to the company
 * representative route (work-email code and a call-back), keeping their
 * document and messages instead of cancelling and starting again.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleNativeCipcOwnerAction(request, (await params).id, "route-switch");
}

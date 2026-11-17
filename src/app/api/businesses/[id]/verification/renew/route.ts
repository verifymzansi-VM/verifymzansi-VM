import { type NextRequest } from "next/server";

import { handleNativeCipcOwnerAction } from "@/lib/foundation/cipc-commands";

/**
 * POST /api/businesses/[id]/verification/renew
 * One-tap renewal: no new upload. Staff fetch a fresh copy from CIPC and
 * decide as usual; the owner only uploads if staff ask for it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleNativeCipcOwnerAction(request, (await params).id, "renew");
}

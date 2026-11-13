import { type NextRequest } from "next/server";

import { handleNativeCipcOwnerAction } from "@/lib/foundation/cipc-commands";

/**
 * POST /api/businesses/[id]/verification/work-email
 * Company representatives confirm a mailbox on the company's own domain:
 * "send" emails a 6-digit code, "verify" checks it (5 tries, 15 minutes).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleNativeCipcOwnerAction(request, (await params).id, "work-email");
}

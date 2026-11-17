import { type NextRequest } from "next/server";

import { handleNativeCipcOwnerAction } from "@/lib/foundation/cipc-commands";

/**
 * PATCH /api/businesses/[id]/verification/office-visibility
 * The owner chooses whether the registered office's street lines are public.
 * Suburb, city and province always show once CIPC is verified.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleNativeCipcOwnerAction(request, (await params).id, "office-visibility");
}

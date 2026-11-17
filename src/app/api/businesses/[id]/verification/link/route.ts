import { type NextRequest } from "next/server";

import { handleNativeCipcOwnerAction } from "@/lib/foundation/cipc-commands";

/**
 * POST /api/businesses/[id]/verification/link
 * A second profile (branch, brand) of a company this owner already verified.
 * No documents: staff confirm the link with one click.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleNativeCipcOwnerAction(request, (await params).id, "link");
}

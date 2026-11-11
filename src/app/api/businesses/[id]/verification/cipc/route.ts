import { type NextRequest } from "next/server";

import { submitNativeCipc } from "@/lib/foundation/cipc-document-route";

/**
 * POST /api/businesses/[id]/verification/cipc
 * Submits a CIPC document for staff review. The upload is evidence only:
 * staff approve from a copy they fetch from CIPC themselves.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return submitNativeCipc(request, (await params).id);
}

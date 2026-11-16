import { type NextRequest } from "next/server";

import { previewNativeCipc } from "@/lib/foundation/cipc-document-route";

/**
 * POST /api/businesses/[id]/verification/cipc/preview
 * Reads a CIPC document so the owner can confirm what we found before
 * submitting. Nothing is stored and nothing is decided here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return previewNativeCipc(request, (await params).id);
}

import { attachNativeOfficialCipc } from "@/lib/foundation/cipc-document-route";

/**
 * POST /api/admin/business-verification/[id]/admin-copy
 * Staff attach the disclosure they fetched from CIPC themselves. It is the
 * source of truth for approval; we parse it and compare it with the owner's
 * upload field by field.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return attachNativeOfficialCipc(request, (await params).id);
}

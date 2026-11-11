/**
 * GET /api/admin/business-verification/files/[fileId]
 * Decrypts and serves one business verification file to staff. Every view
 * is logged first; if the log cannot be written nothing is served. Files
 * with active content are never served — staff get the extracted text.
 */
import { type NextRequest } from "next/server";

import { readSeenEvidenceFile } from "@/lib/foundation/seen-media-route";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  return readSeenEvidenceFile(request, (await params).fileId);
}

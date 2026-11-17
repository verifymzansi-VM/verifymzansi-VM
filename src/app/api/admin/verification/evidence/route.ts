import { type NextRequest, NextResponse } from "next/server";
import { handleFoundationEvidenceRead } from "@/lib/foundation/evidence-route";
import { foundationNoStore } from "@/lib/foundation/owner-route";

/**
 * GET /api/admin/verification/evidence
 * Refused: identifiers in a query string leak into logs and browser history.
 */
export async function GET() {
  return NextResponse.json(
    { error: "Use the protected evidence POST request" },
    { status: 405, headers: foundationNoStore }
  );
}

/**
 * POST /api/admin/verification/evidence
 * Decrypts and serves one KYC artifact for staff review. The artifact and
 * the reviewer's claim are read from the JSON body.
 */
export async function POST(request: NextRequest) {
  return handleFoundationEvidenceRead(request, "restored");
}

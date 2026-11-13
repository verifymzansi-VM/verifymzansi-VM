import { type NextRequest, NextResponse } from "next/server";
import { handleRestoredIdentityMetadata } from "@/lib/foundation/restored-identity-metadata-route";
import { foundationNoStore } from "@/lib/foundation/owner-route";

/**
 * GET /api/admin/verification/evidence/metadata
 * Refused: identifiers in a query string leak into logs and browser history.
 */
export async function GET() {
  return NextResponse.json(
    { error: "Use the protected metadata POST request" },
    { status: 405, headers: foundationNoStore }
  );
}

/**
 * POST /api/admin/verification/evidence/metadata
 * Returns the evidence metadata for a step or user (artifacts, provider
 * results, risk signals, step details), read from the JSON body.
 */
export async function POST(request: NextRequest) {
  return handleRestoredIdentityMetadata(request);
}

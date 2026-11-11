import { NextResponse } from "next/server";

/**
 * POST /api/media/upload-complete
 *
 * Retired: confirmation of a direct-to-R2 upload. Production uploads go
 * through the server-validated /api/media/upload endpoint.
 */
export async function POST() {
  return NextResponse.json(
    { error: "This upload method is no longer available", code: "upload_method_retired" },
    { status: 410, headers: { "Cache-Control": "private, no-store" } }
  );
}

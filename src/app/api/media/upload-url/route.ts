import { NextResponse } from "next/server";

/**
 * POST /api/media/upload-url
 *
 * Retired: the presigned direct-to-R2 upload URL. Production uploads go
 * through the server-validated /api/media/upload endpoint.
 */
export async function POST() {
  return NextResponse.json(
    { error: "This upload method is no longer available", code: "upload_method_retired" },
    { status: 410, headers: { "Cache-Control": "private, no-store" } }
  );
}

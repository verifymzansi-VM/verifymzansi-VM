import { NextResponse, type NextRequest } from "next/server";
import { uploadFoundationMediaRequest } from "./foundation";

/**
 * POST /api/media/upload
 *
 * Upload one or more media files (images/videos) for listings,
 * business ads, or mall shops.
 *
 * Accepts multipart/form-data with:
 * - files: one or more media files
 * - area: one of UPLOAD_AREAS (see @/types/enums)
 */

/** Lightweight health-check for upload preflight. */
export function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(request: NextRequest) {
  return uploadFoundationMediaRequest(request);
}

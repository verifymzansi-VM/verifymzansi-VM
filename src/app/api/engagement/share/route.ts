import { NextResponse } from "next/server";

/**
 * POST /api/engagement/share
 *
 * Closed (roadmap M2.8). The live backend does not store share totals yet.
 * Sharing itself still works and the share button still reports here, so the
 * route answers 204 No Content without reading the request, calling a database or
 * setting a cookie. Rebuild it on the live backend after launch.
 */
export function POST() {
  return new NextResponse(null, { status: 204 });
}

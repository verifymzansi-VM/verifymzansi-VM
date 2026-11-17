import { NextResponse } from "next/server";

/**
 * POST /api/engagement/view
 *
 * Closed (roadmap M2.8). The live backend does not store post views yet, so
 * view counts are hidden (src/lib/hidden-features.ts). Pages still send this
 * beacon, so the route answers 204 No Content without reading the request,
 * calling a database or setting a cookie. Rebuild it on the live backend after
 * launch.
 */
export function POST() {
  return new NextResponse(null, { status: 204 });
}

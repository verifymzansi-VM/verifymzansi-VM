import { NextResponse } from "next/server";

/**
 * POST /api/engagement/like
 *
 * Closed (roadmap M2.8). The live backend does not store likes yet, so the
 * like button is hidden (src/lib/hidden-features.ts). A page opened before
 * that change may still send a like: the route answers 204 No Content without
 * reading the request, calling a database or setting a cookie. Rebuild it on
 * the live backend after launch.
 */
export function POST() {
  return new NextResponse(null, { status: 204 });
}

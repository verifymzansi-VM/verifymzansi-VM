import { NextResponse } from "next/server";

/**
 * POST /api/analytics/events
 *
 * Closed (roadmap M2.8). The live backend does not store impressions, detail
 * views or contact clicks yet. Pages still send these events here, so the route
 * answers 204 No Content without reading the request, calling a database or
 * setting a cookie. Rebuild it on the live backend after launch.
 */
export function POST() {
  return new NextResponse(null, { status: 204 });
}

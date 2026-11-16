import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { checkLocalRateLimit, getClientRateLimitKey } from "@/lib/utils/rate-limit";

/** Viewer-specific and session-specific: never cached anywhere. */
export const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export function feedError(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: PRIVATE_NO_STORE });
}

/**
 * Shared front door for the viewer's read endpoints: a rate limit. The posts
 * themselves come from the foundation's public reads.
 */
export function openFeedRequest(request: NextRequest, action: string, maxPerMinute: number) {
  const limit = checkLocalRateLimit(getClientRateLimitKey(request), action, maxPerMinute);
  return limit.limited ? feedError(429, "Too many requests") : null;
}

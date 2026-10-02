import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { buildViewerKey, ENGAGEMENT_VIEWER_COOKIE } from "@/lib/engagement";
import { isImmersiveDetailEnabled } from "@/lib/feed/flag";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkLocalRateLimit, getClientRateLimitKey } from "@/lib/utils/rate-limit";

/** Viewer-specific (likes) and session-specific: never cached anywhere. */
export const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export function feedError(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: PRIVATE_NO_STORE });
}

/**
 * Shared front door for the viewer's read endpoints: rate limit, the
 * `immersive_detail` flag, and the visitor's own Supabase client.
 */
export async function openFeedRequest(request: NextRequest, action: string, maxPerMinute: number) {
  const limit = checkLocalRateLimit(getClientRateLimitKey(request), action, maxPerMinute);
  if (limit.limited) return { response: feedError(429, "Too many requests") } as const;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = request.cookies.get(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null;
  if (!(await isImmersiveDetailEnabled({ user, viewerId }))) {
    return { response: feedError(404, "Not found") } as const;
  }
  return {
    response: null,
    supabase,
    admin: tryCreateAdminClient(),
    viewerKey: buildViewerKey(viewerId, user?.id),
  } as const;
}

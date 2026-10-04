import { NextResponse, type NextRequest } from "next/server";
import { feedError, PRIVATE_NO_STORE } from "@/app/api/feed/_lib/feed-request";
import { ENGAGEMENT_VIEWER_COOKIE } from "@/lib/engagement";
import { isVideoModeEnabled } from "@/lib/feed/video-mode-flag";
import { createClient } from "@/lib/supabase/server";
import { checkLocalRateLimit, getClientRateLimitKey } from "@/lib/utils/rate-limit";

/**
 * GET /api/feed/video-mode → { enabled }
 * Whether this visitor may see the Video mode entry. The header is shared by
 * cached pages, so it asks here instead of reading the flag at render time.
 */
export async function GET(request: NextRequest) {
  const limit = checkLocalRateLimit(getClientRateLimitKey(request), "feed:video-mode", 30);
  if (limit.limited) return feedError(429, "Too many requests");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const enabled = await isVideoModeEnabled({
    user,
    viewerId: request.cookies.get(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null,
  });
  return NextResponse.json({ enabled }, { headers: PRIVATE_NO_STORE });
}

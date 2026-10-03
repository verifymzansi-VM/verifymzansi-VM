import { NextResponse, type NextRequest } from "next/server";
import { prepareEngagementMutation, setEngagementViewerCookie } from "@/lib/engagement-route";
import { hashAnalyticsKey, isAutomatedUserAgent } from "@/lib/analytics/traffic-quality";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";
import { createLogger } from "@/lib/utils/logger";
import { buildViewerKey } from "@/lib/engagement";

const log = createLogger("EngagementShare");
const TABLES = { listing: "listings", business: "businesses", promotion: "promotions" } as const;
export async function POST(request: NextRequest) {
  try {
    if (
      request.headers.get("dnt") === "1" ||
      isAutomatedUserAgent(request.headers.get("user-agent"))
    )
      return NextResponse.json({ counted: false, shareCount: null });
    const prepared = await prepareEngagementMutation(request, {
      log,
      rateLimitBucket: "engagement:share",
      rateLimitMax: 20,
      missingViewerResponse: NextResponse.json(
        { error: "Missing viewer identity" },
        { status: 400 }
      ),
    });
    if (!prepared.success) return prepared.response;
    const { targetId, targetType, viewerKey, userId } = prepared.data;
    const browserKey = buildViewerKey(prepared.data.existingViewerId || prepared.data.nextViewerId);
    const client = await createClient();
    const { data: post } = await applyVisibleExpiryFilter(
      client.from(TABLES[targetType]).select("id").eq("id", targetId).eq("status", "live")
    ).maybeSingle();
    if (!post) return NextResponse.json({ error: "Post unavailable" }, { status: 404 });
    const { data, error } = await createAdminClient().rpc("record_content_share", {
      p_target_id: targetId,
      p_target_type: targetType,
      p_viewer_key: hashAnalyticsKey(viewerKey),
      p_viewer_user_id: userId ?? null,
      p_anonymous_viewer_key: userId && browserKey ? hashAnalyticsKey(browserKey) : null,
    });
    if (error || !data?.[0])
      return NextResponse.json({ error: "Share total unavailable" }, { status: 503 });
    const response = NextResponse.json({
      counted: Boolean(data[0].counted),
      shareCount: Number(data[0].share_count) || 0,
    });
    setEngagementViewerCookie(response, prepared.data);
    return response;
  } catch {
    return NextResponse.json({ error: "Share total unavailable" }, { status: 503 });
  }
}

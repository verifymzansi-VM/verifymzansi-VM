import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareEngagementMutation, setEngagementViewerCookie } from "@/lib/engagement-route";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("EngagementViewRoute");

export async function POST(request: NextRequest) {
  try {
    const prepared = await prepareEngagementMutation(request, {
      log,
      rateLimitBucket: "engagement:view",
      rateLimitMax: 120,
      missingViewerResponse: NextResponse.json({ ok: false }, { status: 400 }),
    });
    if (!prepared.success) {
      return prepared.response;
    }

    const { targetId, targetType, viewerKey, userId } = prepared.data;
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("record_content_view", {
      p_target_id: targetId,
      p_target_type: targetType,
      p_viewer_key: viewerKey,
      p_viewer_user_id: userId,
      p_viewer_ip_hash: null,
    });

    if (error) {
      log.error("Failed to record content view", {
        targetId,
        targetType,
        error: error.message,
      });
      return NextResponse.json({ error: "Failed to record view" }, { status: 500 });
    }

    const response = NextResponse.json({ ok: true, recorded: Boolean(data) });
    setEngagementViewerCookie(response, prepared.data);

    return response;
  } catch (error) {
    log.error("Unexpected engagement view error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Failed to record view" }, { status: 500 });
  }
}

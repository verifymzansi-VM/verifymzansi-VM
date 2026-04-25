import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareEngagementMutation, setEngagementViewerCookie } from "@/lib/engagement-route";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("EngagementLikeRoute");

type ToggleContentLikeRow = {
  liked: boolean;
  like_count: number;
};

export async function POST(request: NextRequest) {
  try {
    const prepared = await prepareEngagementMutation(request, {
      log,
      rateLimitBucket: "engagement:like",
      rateLimitMax: 40,
      missingViewerResponse: NextResponse.json(
        { error: "Missing viewer identity" },
        { status: 400 }
      ),
    });
    if (!prepared.success) {
      return prepared.response;
    }

    const { targetId, targetType, viewerKey, userId } = prepared.data;
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("toggle_content_like", {
      p_target_id: targetId,
      p_target_type: targetType,
      p_viewer_key: viewerKey,
      p_viewer_user_id: userId,
    });

    if (error) {
      log.error("Failed to toggle content like", {
        targetId,
        targetType,
        error: error.message,
      });
      return NextResponse.json({ error: "Failed to update like" }, { status: 500 });
    }

    const result = ((data ?? []) as ToggleContentLikeRow[])[0] ?? {
      liked: false,
      like_count: 0,
    };

    const response = NextResponse.json({
      liked: Boolean(result.liked),
      likeCount: Number(result.like_count) || 0,
    });
    setEngagementViewerCookie(response, prepared.data);

    return response;
  } catch (error) {
    log.error("Unexpected engagement like error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Failed to update like" }, { status: 500 });
  }
}

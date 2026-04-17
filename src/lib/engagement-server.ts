import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentTargetType } from "@/lib/engagement";

type ContentViewCountRow = {
  target_id: string;
  view_count: number;
};

type ContentLikeSummaryRow = {
  target_id: string;
  like_count: number;
  viewer_has_liked: boolean;
};

export async function getContentViewCountMap(
  admin: SupabaseClient,
  targetType: ContentTargetType,
  targetIds: string[]
) {
  if (targetIds.length === 0) {
    return new Map<string, number>();
  }

  try {
    const rpc = admin.rpc?.bind(admin);
    if (!rpc) {
      return new Map<string, number>();
    }

    const { data, error } = await rpc("get_content_view_counts", {
      p_target_ids: targetIds,
      p_target_type: targetType,
    });

    if (error) {
      return new Map<string, number>();
    }

    return new Map(
      ((data ?? []) as ContentViewCountRow[]).map((row) => [
        row.target_id,
        Number(row.view_count) || 0,
      ])
    );
  } catch {
    return new Map<string, number>();
  }
}

export async function getContentLikeSummaryMap(
  admin: SupabaseClient,
  targetType: ContentTargetType,
  targetIds: string[],
  viewerKey?: string | null
) {
  if (targetIds.length === 0) {
    return new Map<string, { likeCount: number; viewerHasLiked: boolean }>();
  }

  try {
    const rpc = admin.rpc?.bind(admin);
    if (!rpc) {
      return new Map<string, { likeCount: number; viewerHasLiked: boolean }>();
    }

    const { data, error } = await rpc("get_content_like_summary", {
      p_target_ids: targetIds,
      p_target_type: targetType,
      p_viewer_key: viewerKey ?? null,
    });

    if (error) {
      return new Map<string, { likeCount: number; viewerHasLiked: boolean }>();
    }

    return new Map(
      ((data ?? []) as ContentLikeSummaryRow[]).map((row) => [
        row.target_id,
        {
          likeCount: Number(row.like_count) || 0,
          viewerHasLiked: Boolean(row.viewer_has_liked),
        },
      ])
    );
  } catch {
    return new Map<string, { likeCount: number; viewerHasLiked: boolean }>();
  }
}

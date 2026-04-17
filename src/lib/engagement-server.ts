import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentTargetType } from "@/lib/engagement";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("EngagementServer");

type ContentViewCountRow = {
  target_id: string;
  view_count: number;
};

type ContentLikeSummaryRow = {
  target_id: string;
  like_count: number;
  viewer_has_liked: boolean;
};

type EngagementReadErrorCode =
  | "admin_unavailable"
  | "rpc_unavailable"
  | "query_failed"
  | "unexpected_error";

export interface EngagementReadResult<T> {
  ok: boolean;
  data: Map<string, T>;
  errorCode?: EngagementReadErrorCode;
}

export async function getContentViewCountMap(
  admin: SupabaseClient,
  targetType: ContentTargetType,
  targetIds: string[]
) {
  if (targetIds.length === 0) {
    return { ok: true, data: new Map<string, number>() } satisfies EngagementReadResult<number>;
  }

  try {
    const rpc = admin.rpc?.bind(admin);
    if (!rpc) {
      log.warn("Supabase client is missing rpc() while loading content view counts", {
        targetType,
        targetIds,
      });
      return {
        ok: false,
        data: new Map<string, number>(),
        errorCode: "rpc_unavailable",
      } satisfies EngagementReadResult<number>;
    }

    const { data, error } = await rpc("get_content_view_counts", {
      p_target_ids: targetIds,
      p_target_type: targetType,
    });

    if (error) {
      log.warn("Failed to load content view counts", {
        targetType,
        targetIds,
        error: error.message,
      });
      return {
        ok: false,
        data: new Map<string, number>(),
        errorCode: "query_failed",
      } satisfies EngagementReadResult<number>;
    }

    return {
      ok: true,
      data: new Map(
        ((data ?? []) as ContentViewCountRow[]).map((row) => [
          row.target_id,
          Number(row.view_count) || 0,
        ])
      ),
    } satisfies EngagementReadResult<number>;
  } catch (error) {
    log.error("Unexpected error while loading content view counts", {
      targetType,
      targetIds,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      ok: false,
      data: new Map<string, number>(),
      errorCode: "unexpected_error",
    } satisfies EngagementReadResult<number>;
  }
}

export async function getOptionalContentViewCountMap(
  admin: SupabaseClient | null | undefined,
  targetType: ContentTargetType,
  targetIds: string[]
) {
  if (!admin) {
    log.warn("Content view counts unavailable because admin client is missing", {
      targetType,
      targetIds,
    });
    return {
      ok: false,
      data: new Map<string, number>(),
      errorCode: "admin_unavailable",
    } satisfies EngagementReadResult<number>;
  }

  return getContentViewCountMap(admin, targetType, targetIds);
}

export async function getContentLikeSummaryMap(
  admin: SupabaseClient,
  targetType: ContentTargetType,
  targetIds: string[],
  viewerKey?: string | null
) {
  if (targetIds.length === 0) {
    return {
      ok: true,
      data: new Map<string, { likeCount: number; viewerHasLiked: boolean }>(),
    } satisfies EngagementReadResult<{ likeCount: number; viewerHasLiked: boolean }>;
  }

  try {
    const rpc = admin.rpc?.bind(admin);
    if (!rpc) {
      log.warn("Supabase client is missing rpc() while loading content likes", {
        targetType,
        targetIds,
      });
      return {
        ok: false,
        data: new Map<string, { likeCount: number; viewerHasLiked: boolean }>(),
        errorCode: "rpc_unavailable",
      } satisfies EngagementReadResult<{ likeCount: number; viewerHasLiked: boolean }>;
    }

    const { data, error } = await rpc("get_content_like_summary", {
      p_target_ids: targetIds,
      p_target_type: targetType,
      p_viewer_key: viewerKey ?? null,
    });

    if (error) {
      log.warn("Failed to load content like summary", {
        targetType,
        targetIds,
        error: error.message,
      });
      return {
        ok: false,
        data: new Map<string, { likeCount: number; viewerHasLiked: boolean }>(),
        errorCode: "query_failed",
      } satisfies EngagementReadResult<{ likeCount: number; viewerHasLiked: boolean }>;
    }

    return {
      ok: true,
      data: new Map(
        ((data ?? []) as ContentLikeSummaryRow[]).map((row) => [
          row.target_id,
          {
            likeCount: Number(row.like_count) || 0,
            viewerHasLiked: Boolean(row.viewer_has_liked),
          },
        ])
      ),
    } satisfies EngagementReadResult<{ likeCount: number; viewerHasLiked: boolean }>;
  } catch (error) {
    log.error("Unexpected error while loading content like summary", {
      targetType,
      targetIds,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      ok: false,
      data: new Map<string, { likeCount: number; viewerHasLiked: boolean }>(),
      errorCode: "unexpected_error",
    } satisfies EngagementReadResult<{ likeCount: number; viewerHasLiked: boolean }>;
  }
}

export async function getOptionalContentLikeSummaryMap(
  admin: SupabaseClient | null | undefined,
  targetType: ContentTargetType,
  targetIds: string[],
  viewerKey?: string | null
) {
  if (!admin) {
    log.warn("Content like summary unavailable because admin client is missing", {
      targetType,
      targetIds,
    });
    return {
      ok: false,
      data: new Map<string, { likeCount: number; viewerHasLiked: boolean }>(),
      errorCode: "admin_unavailable",
    } satisfies EngagementReadResult<{ likeCount: number; viewerHasLiked: boolean }>;
  }

  return getContentLikeSummaryMap(admin, targetType, targetIds, viewerKey);
}

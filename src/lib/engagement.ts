export const ENGAGEMENT_VIEWER_COOKIE = "vmz_viewer";
export const ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const CONTENT_TARGET_TYPES = ["listing", "promotion", "business"] as const;

export type ContentTargetType = (typeof CONTENT_TARGET_TYPES)[number];

interface _ContentEngagementSnapshot {
  viewCount?: number | null;
  likeCount?: number | null;
  viewerHasLiked?: boolean;
}

export function isContentTargetType(value: string): value is ContentTargetType {
  return CONTENT_TARGET_TYPES.includes(value as ContentTargetType);
}

export function createAnonymousViewerId() {
  return crypto.randomUUID();
}

export function buildViewerKey(viewerId?: string | null, userId?: string | null) {
  if (userId) {
    return `user:${userId}`;
  }

  if (!viewerId) {
    return null;
  }

  return `anon:${viewerId}`;
}

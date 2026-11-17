export const ENGAGEMENT_VIEWER_COOKIE = "vmz_viewer";
export const ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const CONTENT_TARGET_TYPES = ["listing", "promotion", "business"] as const;

export type ContentTargetType = (typeof CONTENT_TARGET_TYPES)[number];

interface _ContentEngagementSnapshot {
  viewCount?: number | null;
  likeCount?: number | null;
  viewerHasLiked?: boolean;
}

export function createAnonymousViewerId() {
  return crypto.randomUUID();
}

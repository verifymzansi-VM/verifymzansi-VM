export const ENGAGEMENT_VIEWER_COOKIE = "vmz_viewer";

export const CONTENT_TARGET_TYPES = ["listing", "promotion", "business"] as const;

export type ContentTargetType = (typeof CONTENT_TARGET_TYPES)[number];

interface _ContentEngagementSnapshot {
  viewCount?: number | null;
  likeCount?: number | null;
  viewerHasLiked?: boolean;
}

/** The Turnstile action of the check that issues the view-and-like identifier
 * (src/components/engagement/viewer-challenge.tsx, /api/engagement/viewer). */
export const VIEWER_CHALLENGE_ACTION = "engagement_viewer";

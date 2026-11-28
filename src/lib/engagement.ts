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

/** Sent with `detail: { pending }` while the "not a robot" check is on screen,
 * so an open pop-up can step aside (the welcome pop-up does). */
export const VIEWER_CHECK_EVENT = "vmz:viewer-check";

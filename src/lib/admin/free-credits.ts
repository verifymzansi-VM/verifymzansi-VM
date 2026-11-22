/**
 * What the staff "Free credits" screen shows and the words for each refusal of
 * the give and extend commands (database update
 * 20261122130744_free_credits.sql). Safe in client components: no locale or
 * time-zone APIs, so the server and the browser agree.
 *
 * A free credit is free posts an admin gives an ID-verified member for a short
 * time: 1 to 6 posts for 1 to 30 days, extended 1 to 30 days at a time. It is
 * never charged and never renews.
 */

/** The bounds the database enforces (internal.give_free_credit). */
export const FREE_CREDIT_POSTS = { min: 1, max: 6, initial: 1 } as const;
export const FREE_CREDIT_DAYS = { min: 1, max: 30, initial: 30 } as const;
export const FREE_CREDIT_REASON = { min: 5, max: 200 } as const;

/** One row of api.list_free_credits(), as the website passes it on. */
export interface FreeCredit {
  id: string;
  /** The member's masked email; null once the account was erased. */
  member: string | null;
  posts: number;
  startsAt: string;
  endsAt: string;
  status: "active" | "ended";
  /** All-time views of the posts the gift funded. */
  views: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/** "22 Dec 2026", in South African time. Empty for an unreadable date. */
export function formatFreeCreditDate(value: string): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const sast = new Date(time + SAST_OFFSET_MS);
  return `${sast.getUTCDate()} ${MONTHS[sast.getUTCMonth()]} ${sast.getUTCFullYear()}`;
}

/** "1 post", "3 posts". */
export function postsLabel(posts: number): string {
  return posts === 1 ? "1 post" : `${posts} posts`;
}

/** The reason a give or extend form may be sent with (the database rechecks it). */
export function freeCreditReasonValid(value: string): boolean {
  const reason = value.trim();
  return (
    reason.length >= FREE_CREDIT_REASON.min &&
    reason.length <= FREE_CREDIT_REASON.max &&
    !reason.includes("\n")
  );
}

/** Stable reasons the free credits route gives for a refusal. */
export type FreeCreditRefusal =
  | "free_credit_member_not_found"
  | "free_credit_identity_required"
  | "free_credit_own_account"
  | "free_credit_posts_invalid"
  | "free_credit_days_invalid"
  | "free_credit_reason_required"
  | "free_credit_not_found"
  | "free_credit_closed"
  | "free_credit_not_allowed";

export const FREE_CREDIT_MESSAGES: Record<FreeCreditRefusal, string> = {
  free_credit_member_not_found: "No active member account has this email.",
  free_credit_identity_required:
    "This member's ID review isn't accepted yet. Free credits are only for ID-verified members.",
  free_credit_own_account: "Free credits can't go to your own account. House slots cover that.",
  free_credit_posts_invalid: "Choose 1 to 6 posts.",
  free_credit_days_invalid: "Choose 1 to 30 days.",
  free_credit_reason_required: "Write a reason of 5 to 200 characters on one line.",
  free_credit_not_found: "This gift wasn't found. Reload the page.",
  free_credit_closed: "This gift can't be extended: the member's account was closed.",
  free_credit_not_allowed: "Only admins can give free credits.",
};

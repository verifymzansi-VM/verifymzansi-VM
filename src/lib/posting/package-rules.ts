import { CURRENT_MAX_APPROVED_CONTENT_EDITS } from "./current-edit-policy";

/** Target foundation rules require explicit selection. Source pages default to
 * the current backend's shared edit limit until their adapters are migrated.
 */
export type PackageRulePolicy = "source" | "foundation";

/** Approved edits per started 30 days of a package; price-only changes are free. */
const EDITS_PER_30_DAYS = 2;

/** Days an expired, sold or archived post is kept before it and its media are deleted. */
const EXPIRED_POST_KEEP_DAYS = 30;

/**
 * Approved edits a post gets over its whole life for a slot of `packageDays`
 * (30 → 2, 90 → 6, 180 → 12; at least 2), as internal.edit_allowance counts
 * them. Free posts and events get 2 (CURRENT_MAX_APPROVED_CONTENT_EDITS).
 */
export function editAllowanceForDays(packageDays: number): number {
  if (!Number.isFinite(packageDays) || packageDays <= 0) return EDITS_PER_30_DAYS;
  return Math.max(EDITS_PER_30_DAYS, EDITS_PER_30_DAYS * Math.ceil(packageDays / 30));
}

/** "up to 2, 6 or 12 approved edits for a 30-, 90- or 180-day slot" */
export const SLOT_EDIT_ALLOWANCE = `up to ${editAllowanceForDays(30)}, ${editAllowanceForDays(90)} or ${editAllowanceForDays(180)} approved edits for a 30-, 90- or 180-day slot`;

export const CURRENT_EDIT_RULE = `Each live post can have ${SLOT_EDIT_ALLOWANCE} (a free post or an event: ${CURRENT_MAX_APPROVED_CONTENT_EDITS}). It stays visible while we review an edit.`;

export type PostKind = "listing" | "business" | "event";

const EDIT_RULE = `Each live post can have ${SLOT_EDIT_ALLOWANCE}. One price change a day doesn't count. Your post stays visible while we check an edit.`;

export const EVENT_EDIT_RULE =
  "Each live event can be edited twice. It stays visible while we check an edit.";

const DELETE_AND_REPOST_RULE =
  "Need a bigger change? Delete the post and put up a new one in the same slot. Your package's end date stays the same.";

const EXPIRY_RULE = `When a post expires it is hidden but kept in your dashboard for ${EXPIRED_POST_KEEP_DAYS} days, with reminders to renew. After that the post and its photos and videos are deleted.`;

const KIND_LABEL: Record<PostKind, string> = {
  listing: "listing",
  business: "business profile",
  event: "event",
};

/** Message shown when a post has used its edits for its package. */
export function editLimitReachedMessage(
  kind: PostKind,
  policy: PackageRulePolicy = "source"
): string {
  const label = KIND_LABEL[kind];
  if (policy === "source")
    return kind === "event"
      ? `This ${label} has used its ${CURRENT_MAX_APPROVED_CONTENT_EDITS} approved edits.`
      : `This ${label} has used all its approved edits: ${SLOT_EDIT_ALLOWANCE} (a free post: ${CURRENT_MAX_APPROVED_CONTENT_EDITS}).`;
  return kind === "listing"
    ? `This ${label} has used all its edits for its package. You can still change the price once a day. For other changes, delete it and post it again in the same slot.`
    : `This ${label} has used all its edits. For other changes, delete it and post it again in the same slot.`;
}

/** The rules a person sees when they press Edit, in order. */
export function editScreenRules(kind: PostKind, policy: PackageRulePolicy = "source"): string[] {
  if (policy === "source") return [CURRENT_EDIT_RULE];
  return [kind === "event" ? EVENT_EDIT_RULE : EDIT_RULE, DELETE_AND_REPOST_RULE, EXPIRY_RULE];
}

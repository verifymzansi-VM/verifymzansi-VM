/**
 * One mapping from stored content status to the lifecycle shown to people.
 * Subscription state is separate: "Sponsored" is derived from the slot that
 * holds the post, never stored as a content status.
 */
export type DisplayContentStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "ACTIVE"
  | "SOLD"
  | "EXPIRED"
  | "INACTIVE"
  | "SUSPENDED"
  | "REJECTED"
  | "ARCHIVED";

/** Written by owner_content_action('deactivate'). */
export const OWNER_DEACTIVATED_REASON = "Deactivated by owner";

export function toDisplayContentStatus(
  status: string | null | undefined,
  statusReason?: string | null
): DisplayContentStatus {
  switch (status) {
    case "draft":
      return "DRAFT";
    case "pending_moderation":
    case "pending_review":
    case "flagged_for_review":
      return "PENDING_REVIEW";
    case "live":
    case "active":
      return "ACTIVE";
    case "sold":
      return "SOLD";
    case "expired":
      return "EXPIRED";
    case "hidden":
      return statusReason === OWNER_DEACTIVATED_REASON ? "INACTIVE" : "SUSPENDED";
    case "suspended":
      return "SUSPENDED";
    case "rejected":
      return "REJECTED";
    case "archived":
      return "ARCHIVED";
    default:
      return "DRAFT";
  }
}

export const DISPLAY_STATUS_LABELS: Record<DisplayContentStatus, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Under review",
  ACTIVE: "Active",
  SOLD: "Sold",
  EXPIRED: "Expired",
  INACTIVE: "Inactive",
  SUSPENDED: "Hidden",
  REJECTED: "Rejected",
  ARCHIVED: "Archived",
};

export type EventLifecycle = "DRAFT" | "PUBLISHED" | "ACTIVE" | "ENDED" | "ARCHIVED";

export const EVENT_LIFECYCLE_LABELS: Record<EventLifecycle, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Upcoming",
  ACTIVE: "Happening now",
  ENDED: "Ended",
  ARCHIVED: "Archived",
};

/** Free events: Draft → Published → Active → Ended → Archived (derived, not stored). */
export function eventLifecycle(
  input: {
    status: string | null | undefined;
    start_date?: string | null;
    end_date?: string | null;
  },
  now: Date = new Date()
): EventLifecycle {
  if (input.status === "archived") return "ARCHIVED";
  const end = input.end_date ? Date.parse(input.end_date) : NaN;
  if (input.status === "expired" || (!Number.isNaN(end) && end <= now.getTime())) return "ENDED";
  if (input.status !== "live") return "DRAFT";
  const start = input.start_date ? Date.parse(input.start_date) : NaN;
  return !Number.isNaN(start) && start > now.getTime() ? "PUBLISHED" : "ACTIVE";
}

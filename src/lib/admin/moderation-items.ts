import type { ClaimItemType } from "@/lib/services/queue-claims";

/** Which queue claim covers a content item: an edit request, or the post itself. */
export function claimTypeOf(item: {
  isEditRequest?: boolean;
  contentType?: "listing" | "business" | "promotion";
}): ClaimItemType {
  return item.isEditRequest ? "content_edit" : (item.contentType ?? "listing");
}

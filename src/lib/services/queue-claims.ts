import type { FrontendClaimType } from "@/lib/foundation/staff-claims";

/**
 * Queue claims, read from the foundation staff claim commands. Moderators
 * claim the next items from a queue and only the holder can decide them while
 * the claim lasts; the database enforces the claim on every decision.
 */

export type ClaimQueue = "reports" | "kyc" | "content" | "business_kyc";
export type ClaimItemType = FrontendClaimType;

export interface ClaimView {
  mine: boolean;
  holderName: string;
  expiresAt: string;
}

/** Live claims on the given items, keyed `${type}:${id}`, for queue screens. */
export async function getClaimsForItems(
  viewerId: string,
  items: Array<{ type: ClaimItemType; id: string }>
): Promise<Record<string, ClaimView>> {
  if (items.length === 0) return {};
  const { readFrontendStaffClaimViews } = await import("@/lib/foundation/staff-claims-server");
  return readFrontendStaffClaimViews(viewerId, items);
}

/**
 * The items the viewer holds in a queue. Queue screens always load these,
 * even when they fall outside the page's usual limit, so a moderator can
 * always see what they have claimed.
 */
export async function getMyClaimedItems(
  viewerId: string,
  queue: ClaimQueue
): Promise<Array<{ type: ClaimItemType; id: string }>> {
  const { readMyFrontendStaffClaims } = await import("@/lib/foundation/staff-claims-server");
  return (await readMyFrontendStaffClaims(viewerId)).items
    .filter((i) => i.mine && i.queue === queue)
    .map((i) => ({ type: i.item_type, id: i.id }));
}

/** How many live claims the viewer holds in a queue. */
export async function countMyClaims(viewerId: string, queue: ClaimQueue): Promise<number> {
  const { readMyFrontendStaffClaims } = await import("@/lib/foundation/staff-claims-server");
  return (await readMyFrontendStaffClaims(viewerId)).items.filter(
    (i) => i.mine && i.queue === queue
  ).length;
}

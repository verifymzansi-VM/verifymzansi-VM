import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { getDataBackend } from "@/lib/data-backend";
import type { FrontendClaimType } from "@/lib/foundation/staff-claims";

const log = createLogger("QueueClaims");

/**
 * Queue claims (20260928120000_queue_claims.sql). Moderators claim the next
 * items from a queue and only the holder can decide them while the claim
 * lasts; governors and admins may act on unclaimed items and can free or
 * reassign claims. The database locks the work rows, so moderators never
 * receive the same item.
 */

export type ClaimQueue = "reports" | "kyc" | "content" | "business_kyc";
export type ClaimItemType = FrontendClaimType;

export interface ClaimedItem {
  item_type: ClaimItemType;
  item_id: string;
  token: string;
  expires_at: string;
}

export async function claimNextItems(actorId: string, queue: ClaimQueue, limit: number) {
  const { data, error } = await createAdminClient().rpc("claim_queue_items", {
    p_actor: actorId,
    p_queue: queue,
    p_limit: limit,
  });
  if (error) {
    if (error.message.includes("claim_forbidden"))
      return { ok: false as const, error: "forbidden" };
    throw new Error(`claim_queue_items failed: ${error.message}`);
  }
  return { ok: true as const, items: (data ?? []) as ClaimedItem[] };
}

async function countRpc(fn: string, args: Record<string, unknown>): Promise<number> {
  const { data, error } = await createAdminClient().rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return typeof data === "number" ? data : 0;
}

const releaseClaims = (actorId: string, item?: { type: ClaimItemType; id: string }) =>
  countRpc("release_queue_claims", {
    p_actor: actorId,
    p_item_type: item?.type ?? null,
    p_item_id: item?.id ?? null,
  });

const CLAIM_REFUSALS: Record<string, [number, string]> = {
  claim_required: [409, "Claim this item from the queue before deciding it."],
  claimed_by_other: [409, "Another moderator is working on this item."],
  not_independent: [403, "You cannot decide an item that you reported, own or are the subject of."],
  forbidden: [403, "Your role cannot work this queue."],
  reason_required: [400, "Give a reason of at least 5 characters."],
  not_claimed: [409, "Nobody holds this item any more."],
  invalid_assignee: [400, "Choose a moderator or admin who can work this queue."],
};

function claimRefusalResponse(error: string): NextResponse {
  const [status, message] = CLAIM_REFUSALS[error] ?? [
    409,
    "This item cannot be decided right now.",
  ];
  return NextResponse.json({ error: message, code: error }, { status });
}

/**
 * Before a decision: may this actor decide the item now? Returns a response
 * to send back, or null to continue. Fails closed if the check errors.
 */
export async function checkQueueClaim(
  actorId: string,
  item: { type: ClaimItemType; id: string }
): Promise<NextResponse | null> {
  const { data, error } = await createAdminClient().rpc("check_queue_claim", {
    p_actor: actorId,
    p_item_type: item.type,
    p_item_id: item.id,
  });
  if (error) {
    log.error("Claim check failed", { error: error.message, itemType: item.type });
    return NextResponse.json({ error: "Try again in a moment." }, { status: 503 });
  }
  const result = data as { ok: boolean; error?: string };
  return result.ok ? null : claimRefusalResponse(result.error ?? "claim_required");
}

/** After a decision: release the actor's claim on the item (best effort). */
export async function releaseDecidedClaim(
  actorId: string,
  item: { type: ClaimItemType; id: string }
) {
  try {
    await releaseClaims(actorId, item);
  } catch (err) {
    // The claim expires on its own; the item's status already moved on.
    log.warn("Could not release claim after decision", {
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

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
  if (getDataBackend() === "foundation") {
    const { readFrontendStaffClaimViews } = await import("@/lib/foundation/staff-claims-server");
    return readFrontendStaffClaimViews(viewerId, items);
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("queue_claims")
    .select("item_type, item_id, claimed_by, expires_at")
    .in(
      "item_id",
      items.map((i) => i.id)
    )
    .gt("expires_at", new Date().toISOString());
  if (error || !data?.length) return {};

  const holders = [...new Set(data.map((c) => c.claimed_by as string))];
  const { data: profiles } = await admin
    .from("account_profiles")
    .select("user_id, display_name")
    .in("user_id", holders);
  const names = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name] as const));

  const views: Record<string, ClaimView> = {};
  for (const c of data) {
    views[`${c.item_type}:${c.item_id}`] = {
      mine: c.claimed_by === viewerId,
      holderName:
        c.claimed_by === viewerId ? "you" : names.get(c.claimed_by) || "another moderator",
      expiresAt: c.expires_at,
    };
  }
  return views;
}

/**
 * The items the viewer holds in a queue. Queue screens always load these,
 * even when they fall outside the page's usual limit, so a moderator can
 * always see what they have claimed. Empty when claims cannot be read.
 */
export async function getMyClaimedItems(
  viewerId: string,
  queue: ClaimQueue
): Promise<Array<{ type: ClaimItemType; id: string }>> {
  if (getDataBackend() === "foundation") {
    const { readMyFrontendStaffClaims } = await import("@/lib/foundation/staff-claims-server");
    return (await readMyFrontendStaffClaims(viewerId)).items
      .filter((i) => i.mine && i.queue === queue)
      .map((i) => ({ type: i.item_type, id: i.id }));
  }
  const { data, error } = await createAdminClient()
    .from("queue_claims")
    .select("item_type, item_id")
    .eq("claimed_by", viewerId)
    .eq("queue", queue)
    .gt("expires_at", new Date().toISOString());
  if (error) {
    log.warn("Could not read the viewer's claims", { error: error.message, queue });
    return [];
  }
  return (data ?? []).map((c) => ({ type: c.item_type as ClaimItemType, id: c.item_id as string }));
}

/** How many live claims the viewer holds in a queue. */
export async function countMyClaims(viewerId: string, queue: ClaimQueue): Promise<number> {
  if (getDataBackend() === "foundation") {
    const { readMyFrontendStaffClaims } = await import("@/lib/foundation/staff-claims-server");
    return (await readMyFrontendStaffClaims(viewerId)).items.filter(
      (i) => i.mine && i.queue === queue
    ).length;
  }
  const { count } = await createAdminClient()
    .from("queue_claims")
    .select("item_id", { count: "exact", head: true })
    .eq("claimed_by", viewerId)
    .eq("queue", queue)
    .gt("expires_at", new Date().toISOString());
  return count ?? 0;
}

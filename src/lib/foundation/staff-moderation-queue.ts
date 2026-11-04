import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { parseRestoredOwnerPost, restoredOwnerPostRow } from "./restored-owner-posts";
import type { ModerationItem } from "@/components/admin/moderation/moderation-preview-panel";
import type { ClaimView } from "../services/queue-claims";
import { claimTypeOf } from "../admin/moderation-items";
import { getContentEditChanges } from "../content-edit-diff";
import { FoundationStaffReadError } from "./staff-read";
const instant = z.iso.datetime({ offset: true });
const generation = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((v) => BigInt(v) <= BigInt("9223372036854775807"));
const queue = z.strictObject({
  account_id: z.uuid(),
  total: z.number().int().nonnegative(),
  my_claims: z.number().int().min(0).max(20),
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        kind: z.enum(["listing", "business", "event"]),
        area: z.enum(["market", "business", "tourism_events"]),
        category: z.string(),
        title: z.string().nullable(),
        created_at: instant,
        updated_at: instant,
        revision: z.number().int().positive(),
        edit_of: z.uuid().nullable(),
        owner_id: z.uuid().nullable(),
        claim: z
          .strictObject({
            mine: z.boolean(),
            holderName: z.string(),
            expiresAt: instant,
            generation: generation.nullable(),
            nonce: z.uuid().nullable(),
          })
          .refine((v) =>
            v.mine
              ? v.generation !== null && v.nonce !== null
              : v.generation === null && v.nonce === null
          )
          .nullable(),
        review: z.unknown(),
        live: z.unknown(),
      })
    )
    .max(220),
});
const labels = {
  market: ["MZANSI_MARKET", "Mzansi Market"],
  business: ["MZANSI_BUSINESS", "Mzansi Business"],
  tourism_events: ["PROMOTIONS_EVENTS", "Tourism & Events"],
} as const;
/** Unclaimed rows are queue summaries. Full review data and exact fences can
 * only come from the caller's currently held native claim. */
export function parseStaffModerationQueue(input: unknown, accountId: string) {
  const facts = queue.parse(input);
  if (
    facts.account_id !== accountId ||
    new Set(facts.items.map((r) => r.id)).size !== facts.items.length
  )
    throw new FoundationStaffReadError(503);
  const claims: Record<string, ClaimView> = {};
  const allItems: ModerationItem[] = facts.items.map((row) => {
    if (
      (row.kind === "listing") !== (row.area === "market") ||
      (row.kind === "event" && row.area !== "tourism_events")
    )
      throw new FoundationStaffReadError(503);
    const post = parseRestoredOwnerPost(row.review);
    const live = parseRestoredOwnerPost(row.live);
    if (
      post &&
      (!row.claim?.mine ||
        !row.owner_id ||
        post.id !== row.id ||
        post.revision !== row.revision ||
        post.kind !== row.kind ||
        post.area !== row.area ||
        post.edit_of !== row.edit_of ||
        post.status !== "pending_moderation")
    )
      throw new FoundationStaffReadError(503);
    if (
      live &&
      (!post || live.id !== row.edit_of || live.edit_of !== null || live.kind !== post.kind)
    )
      throw new FoundationStaffReadError(503);
    if (!post && (row.owner_id || live)) throw new FoundationStaffReadError(503);
    const values = post ? restoredOwnerPostRow(post, row.owner_id!) : {};
    const current = live ? restoredOwnerPostRow(live, row.owner_id!) : null;
    const [area, areaLabel] = labels[row.area];
    const contentType = row.kind === "event" ? "promotion" : row.kind;
    // The owner projection is runtime-validated above, including media keys,
    // canonical price and supplemental presentation. Whitelist rendering data
    // through the same established owner-to-selected-form adapter.
    const item = {
      ...values,
      id: row.id,
      title: post?.content.title ?? row.title ?? "Untitled post",
      created_at: row.created_at,
      updated_at: row.updated_at,
      status: "pending_moderation",
      area,
      areaLabel,
      contentType,
      category: row.category,
      itemType: `${row.kind === "listing" ? "Listing" : row.kind === "event" ? "Event" : row.area === "tourism_events" ? "Tourism business" : "Business"}${row.edit_of ? " edit" : ""}`,
      isEditRequest: row.edit_of !== null,
      ...(row.edit_of ? { targetId: row.edit_of } : {}),
      ...(post && row.claim?.mine
        ? {
            foundation: {
              expectedRevision: post.revision,
              claimGeneration: row.claim.generation!,
              claimNonce: row.claim.nonce!,
            },
          }
        : {}),
      ...(current
        ? { current_snapshot: current, change_summary: getContentEditChanges(current, values) }
        : {}),
    } as ModerationItem;
    if (row.claim)
      claims[`${claimTypeOf(item)}:${row.id}`] = {
        mine: row.claim.mine,
        holderName: row.claim.holderName,
        expiresAt: row.claim.expiresAt,
      };
    return item;
  });
  return {
    allItems,
    claims,
    myClaims: facts.my_claims,
    totalWaiting: facts.total,
    failedAreas: [] as string[],
  };
}
export async function readStaffModerationQueue(api: FoundationAuthenticatedApi, accountId: string) {
  const result = await api.rpc(
    "get_frontend_staff_moderation_queue",
    { p_limit: 50 },
    { get: false }
  );
  if (result.error)
    throw new FoundationStaffReadError(
      result.error.code === "42501" ? 403 : 503,
      result.error.code === "42501"
    );
  return parseStaffModerationQueue(result.data, accountId);
}

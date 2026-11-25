import "server-only";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { listRestoredOwnerPosts, restoredOwnerPostRow } from "./restored-owner-posts";
import { restoredAreaSchema } from "./areas";
const count = z.number().int().nonnegative(),
  instant = z.iso.datetime({ offset: true });
const slot = z.strictObject({
  id: z.uuid(),
  source: z.string(),
  area: restoredAreaSchema.nullable(),
  planName: z.string().nullable(),
  status: z.literal("active"),
  slotCapacity: count,
  activeUsage: count,
  activationCount: count,
  activationLimitTotal: count.nullable(),
  activationLimitPerPeriod: count.nullable(),
  activationPeriodDays: z.number().int().positive(),
  periodActivations: count,
  startsAt: instant,
  expiresAt: instant,
  autoRenew: z.literal(false),
  sponsored: z.boolean(),
});
const manager = z.strictObject({
  account_id: z.uuid(),
  slot_usage: z.array(slot).max(1000),
  plan_admins: z
    .array(
      z.strictObject({
        entitlementId: z.uuid(),
        slotCapacity: count,
        expiresAt: instant,
        admins: z
          .array(z.strictObject({ name: z.string(), email: z.string().nullable() }))
          .max(1000),
      })
    )
    .max(1000),
  sponsored_post_ids: z.array(z.uuid()).max(10000),
  // Paid add-ons were removed from the website; the database may still return
  // these dates until its add-on commands are retired. Optional, read and
  // ignored.
  addons: z
    .array(
      z.strictObject({
        post_id: z.uuid(),
        boost_until: instant.nullable(),
        featured_until: instant.nullable(),
        urgent_until: instant.nullable(),
      })
    )
    .max(10000)
    .optional(),
});
export async function readRestoredPostManager(api: FoundationAuthenticatedApi, accountId: string) {
  const [result, listings, businesses, events] = await Promise.all([
    api.rpc("get_my_frontend_post_manager", {}, { get: false }),
    listRestoredOwnerPosts(api, "listing"),
    listRestoredOwnerPosts(api, "business"),
    listRestoredOwnerPosts(api, "event"),
  ]);
  if (result.error) throw new Error("Post management is temporarily unavailable");
  const facts = manager.parse(result.data);
  if (facts.account_id !== accountId) throw new Error("Account changed");
  const rows = (posts: typeof listings) =>
    posts.map((post) => restoredOwnerPostRow(post, accountId));
  return {
    responses: [
      { data: rows(listings), error: null },
      { data: rows(businesses), error: null },
      { data: rows(events), error: null },
    ] as const,
    sponsoredIds: new Set(facts.sponsored_post_ids),
    slotUsage: facts.slot_usage,
    planAdmins: facts.plan_admins,
  };
}

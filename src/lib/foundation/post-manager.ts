import "server-only";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { listRestoredOwnerPosts, restoredOwnerPostRow } from "./restored-owner-posts";
import { readFoundationOwnerDashboard } from "./owner-dashboard";
import type { MarketplaceArea, PlanTier } from "@/types/enums";
const count = z.number().int().nonnegative(),
  instant = z.iso.datetime({ offset: true });
const slot = z.strictObject({
  id: z.uuid(),
  source: z.string(),
  area: z.enum(["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"]).nullable(),
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
  addons: z
    .array(
      z.strictObject({
        post_id: z.uuid(),
        boost_until: instant.nullable(),
        featured_until: instant.nullable(),
        urgent_until: instant.nullable(),
      })
    )
    .max(10000),
});
export async function readRestoredPostManager(api: FoundationAuthenticatedApi, accountId: string) {
  const [result, listings, businesses, events, dashboard] = await Promise.all([
    api.rpc("get_my_frontend_post_manager", {}, { get: false }),
    listRestoredOwnerPosts(api, "listing"),
    listRestoredOwnerPosts(api, "business"),
    listRestoredOwnerPosts(api, "event"),
    readFoundationOwnerDashboard(api, accountId),
  ]);
  if (result.error) throw new Error("Post management is temporarily unavailable");
  const facts = manager.parse(result.data);
  if (facts.account_id !== accountId) throw new Error("Account changed");
  const addons = new Map(facts.addons.map((row) => [row.post_id, row]));
  const rows = (posts: typeof listings) =>
    posts.map((post) => ({ ...restoredOwnerPostRow(post, accountId), ...addons.get(post.id) }));
  const tiers: Record<MarketplaceArea, PlanTier> = {
    MZANSI_MARKET: "starter",
    MZANSI_BUSINESS: "starter",
    PROMOTIONS_EVENTS: "starter",
  };
  const priority = ["month", "quarter", "half_year", "year", "enterprise"];
  for (const plan of dashboard.paid_plans)
    if (plan.area && plan.tier && priority.indexOf(plan.tier) > priority.indexOf(tiers[plan.area]))
      tiers[plan.area] = plan.tier;
  return {
    responses: [
      { data: rows(listings), error: null },
      { data: rows(businesses), error: null },
      { data: rows(events), error: null },
    ] as const,
    sponsoredIds: new Set(facts.sponsored_post_ids),
    slotUsage: facts.slot_usage,
    planAdmins: facts.plan_admins,
    tiers,
  };
}

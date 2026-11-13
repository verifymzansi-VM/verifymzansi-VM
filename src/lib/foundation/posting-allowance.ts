import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { MarketplaceArea } from "@/types/enums";
import { PLANS, type PlanDefinition } from "../constants/pricing";
import type { FoundationBillingCatalogue } from "./billing-catalogue";
import { foundationArea } from "./areas";
const count = z.number().int().nonnegative();
export const postingAllowanceSchema = z
  .strictObject({
    account_id: z.uuid(),
    profile_exists: z.boolean(),
    capacity: count,
    used: count,
    creation_remaining: count,
    max_photos: count.max(50),
    max_videos: count.max(10),
    tier: z.enum(["free", "active", "month", "quarter", "half_year", "enterprise"]),
    trial_ends_at: z.iso.datetime({ offset: true }).nullable(),
    trial_used: z.boolean(),
    trial_offer: z.strictObject({
      eligible: z.boolean(),
      sevenDayAvailable: z.boolean(),
      thirtyDayAvailable: z.boolean(),
      remaining: z.null(),
      launchEnabled: z.literal(true),
      shortDays: z.literal(7),
      longDays: z.literal(30),
    }),
  })
  .refine((value) => value.creation_remaining <= Math.max(0, value.capacity - value.used));
export type PostingAllowance = z.infer<typeof postingAllowanceSchema>;
export async function readPostingAllowance(api: FoundationAuthenticatedApi, area: MarketplaceArea) {
  const result = await api.rpc(
    "get_my_frontend_posting_allowance_v2",
    { p_area: foundationArea(area) },
    { get: false }
  );
  if (result.error) throw new Error("Posting allowance is unavailable");
  return postingAllowanceSchema.parse(result.data);
}
/** Presentation only; commands still enforce live funding, identity and quotas. */
export function restoredPostingPlanInfo(facts: PostingAllowance, now = Date.now()) {
  const offerAvailable = facts.capacity === 0 && facts.trial_offer.eligible;
  return {
    tier: facts.tier,
    isTrial: offerAvailable,
    trialDaysLeft: facts.trial_ends_at
      ? Math.max(0, Math.ceil((Date.parse(facts.trial_ends_at) - now) / 86400000))
      : 0,
    freePostAvailable: offerAvailable,
    offer: facts.trial_offer,
    freePostsUsed: facts.trial_used ? 1 : 0,
    freePostsRemaining: offerAvailable ? 1 : 0,
    postingLimitBypassEnabled: false,
    currentCount: facts.used,
    maxAllowed: facts.capacity || (offerAvailable ? 1 : 0),
    creationRemaining: offerAvailable ? 1 : facts.creation_remaining,
    maxPhotos: facts.max_photos,
    maxVideos: facts.max_videos,
    videoAllowed: facts.max_videos > 0,
  };
}
export function restoredPostingPlans(
  catalogue: FoundationBillingCatalogue,
  area: MarketplaceArea
): PlanDefinition[] {
  return PLANS.filter((p) => p.area === area).flatMap((base) => {
    const matches = catalogue.plans.filter(
      (p) =>
        (p.area === foundationArea(area) || p.area === null) &&
        p.slot_capacity === 1 &&
        p.duration_days === base.durationDays
    );
    if (matches.length !== 1) return [];
    const plan = matches[0];
    return [
      {
        ...base,
        name: plan.label,
        priceCents: Number(plan.price_cents),
        compareAtCents: undefined,
        features: {
          ...base.features,
          maxPhotos: plan.max_photos,
          maxVideos: plan.max_videos,
          videoAllowed: plan.max_videos > 0,
          maxPostsPerMonth: plan.activations_per_period ?? base.features.maxPostsPerMonth,
          boostAllowed: plan.addon_capabilities.includes("boost"),
          featuredAllowed: plan.addon_capabilities.includes("featured"),
          urgentAllowed: plan.addon_capabilities.includes("urgent"),
        },
      },
    ];
  });
}

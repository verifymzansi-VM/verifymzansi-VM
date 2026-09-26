import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { getPostingAllowance } from "@/lib/commercial/allowance";
import { getCommercialSettings } from "@/lib/commercial/settings";
import { getEntitlements, type Entitlements } from "@/lib/services/entitlements";
import type { AppLogger } from "@/lib/utils/logger";
import type { MarketplaceArea, PlanTier } from "@/types/enums";

export { slotLimitReason } from "@/lib/services/entitlements";

type EntitlementQueryClient = Pick<SupabaseClient, "from">;

type PostingEntitlementsResult =
  | {
      entitlements: {
        maxPhotos: number;
        maxVideos: number;
        videoAllowed: boolean;
      };
      response?: never;
    }
  | {
      entitlements?: never;
      response: NextResponse;
    };

type ActivePostingPlanResult =
  | {
      hasPaidPlan: boolean;
      tier: PlanTier | null;
      entitlements: Entitlements;
      response?: never;
    }
  | {
      hasPaidPlan?: never;
      tier?: never;
      entitlements?: never;
      response: NextResponse;
    };

type PostingMediaEntitlements = {
  maxPhotos: number;
  maxVideos: number;
  videoAllowed: boolean;
};

type PostingMediaLimitOptions = {
  entitlements: PostingMediaEntitlements;
  photoCount: number;
  videoCount: number;
  photoLabel?: string;
  videoUnavailableMessage?: string;
};

function getFreeEntitlements(): Entitlements {
  return {
    maxAllowed: FREE_POST_CONFIG.maxAllowed,
    maxPhotos: FREE_POST_CONFIG.maxPhotos,
    maxVideos: FREE_POST_CONFIG.maxVideos,
    maxPostsPerMonth: FREE_POST_CONFIG.maxAllowed,
    videoAllowed: FREE_POST_CONFIG.videoAllowed,
    boostAllowed: false,
    featuredAllowed: false,
    urgentAllowed: false,
  };
}

async function getLegacyPostingPlan(
  supabase: EntitlementQueryClient,
  userId: string,
  area: MarketplaceArea,
  log: AppLogger
): Promise<ActivePostingPlanResult> {
  const { data: activeEntitlement, error: entitlementError } = await supabase
    .from("entitlements")
    .select("tier")
    .eq("user_id", userId)
    .eq("area", area)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (entitlementError) {
    log.error("Failed to check entitlements", { userId, error: entitlementError.message });
    return {
      response: NextResponse.json(
        { error: "Unable to verify subscription status" },
        { status: 503 }
      ),
    };
  }

  const tier = (activeEntitlement?.tier as PlanTier | null | undefined) ?? null;
  return {
    hasPaidPlan: Boolean(activeEntitlement),
    tier,
    entitlements: tier ? getEntitlements(tier, area) : getFreeEntitlements(),
  };
}

async function getActivePostingPlan(
  supabase: EntitlementQueryClient,
  userId: string,
  area: MarketplaceArea,
  log: AppLogger
): Promise<ActivePostingPlanResult> {
  // Paid, programme and sponsored capacity all come from active posting slots.
  let allowance;
  try {
    allowance = await getPostingAllowance(userId, area);
  } catch (error) {
    // Deploy-order safety: before the slot migration is applied, fall back to
    // the per-area entitlement summary. Publication triggers stay authoritative.
    log.warn("Posting allowance unavailable; using entitlement summary", {
      userId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return getLegacyPostingPlan(supabase, userId, area, log);
  }

  if (!allowance.hasPaidPlan) {
    return { hasPaidPlan: false, tier: null, entitlements: getFreeEntitlements() };
  }

  return {
    hasPaidPlan: true,
    // Slots are area-agnostic; the tier only labels messages and add-on checks.
    tier: "month",
    entitlements: {
      maxAllowed: allowance.capacity,
      maxPhotos: allowance.maxPhotos,
      maxVideos: allowance.maxVideos,
      maxPostsPerMonth: allowance.capacity,
      videoAllowed: allowance.maxVideos > 0,
      boostAllowed: allowance.boostAllowed,
      featuredAllowed: allowance.boostAllowed,
      urgentAllowed: allowance.boostAllowed,
    },
  };
}

export async function getPostingEntitlementsOrResponse(
  supabase: EntitlementQueryClient,
  userId: string,
  area: MarketplaceArea,
  log: AppLogger
): Promise<PostingEntitlementsResult> {
  const result = await getActivePostingPlan(supabase, userId, area, log);
  if (result.response) {
    return result;
  }

  return { entitlements: result.entitlements };
}

export async function getActivePostingPlanOrResponse(
  supabase: EntitlementQueryClient,
  userId: string,
  area: MarketplaceArea,
  log: AppLogger
): Promise<ActivePostingPlanResult> {
  return getActivePostingPlan(supabase, userId, area, log);
}

export function enforcePostingMediaLimits({
  entitlements,
  photoCount,
  videoCount,
  photoLabel = "photos",
  videoUnavailableMessage = "Video upload is not available on your current plan.",
}: PostingMediaLimitOptions): NextResponse | null {
  if (photoCount > entitlements.maxPhotos) {
    return NextResponse.json(
      { error: `Maximum ${entitlements.maxPhotos} ${photoLabel} allowed on your plan` },
      { status: 422 }
    );
  }

  if (videoCount > 0 && !entitlements.videoAllowed) {
    return NextResponse.json({ error: videoUnavailableMessage }, { status: 422 });
  }

  if (videoCount > entitlements.maxVideos) {
    return NextResponse.json(
      { error: `Maximum ${entitlements.maxVideos} videos allowed on your plan` },
      { status: 422 }
    );
  }

  return null;
}

/**
 * Free events: fair-use creation limit per rolling 30 days. Active-event
 * limits are enforced again by the publication trigger.
 */
export async function enforceEventCreationLimit(
  admin: SupabaseClient,
  userId: string,
  log: AppLogger,
  media: { photoCount: number; videoCount: number } = { photoCount: 0, videoCount: 0 }
): Promise<NextResponse | null> {
  const settings = await getCommercialSettings(admin as never);
  const mediaBlock = enforcePostingMediaLimits({
    entitlements: {
      maxPhotos: settings.events.maxPhotos,
      maxVideos: settings.events.maxVideos,
      videoAllowed: settings.events.maxVideos > 0,
    },
    photoCount: media.photoCount,
    videoCount: media.videoCount,
    videoUnavailableMessage: "Video is not available on free events.",
  });
  if (mediaBlock) return mediaBlock;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("promotions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .eq("promotion_type", "event")
    .gte("created_at", since);

  if (error) {
    log.error("Failed to check event fair use", { userId, error: error.message });
    return NextResponse.json({ error: "Unable to verify event limits" }, { status: 503 });
  }

  if ((count ?? 0) >= settings.events.maxCreatedPer30Days) {
    return NextResponse.json(
      {
        error: "Event limit reached",
        reason: `Events are free, with up to ${settings.events.maxCreatedPer30Days} new events per 30 days. Contact VerifyMzansi for an organiser allowance.`,
      },
      { status: 429 }
    );
  }

  return null;
}

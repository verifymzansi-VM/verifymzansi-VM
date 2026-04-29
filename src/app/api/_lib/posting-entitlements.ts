import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { getEntitlements, type Entitlements } from "@/lib/services/entitlements";
import type { AppLogger } from "@/lib/utils/logger";
import type { MarketplaceArea, PlanTier } from "@/types/enums";

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

async function getActivePostingPlan(
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
    log.error("Failed to check entitlements", {
      userId,
      error: entitlementError.message,
    });
    return {
      response: NextResponse.json(
        { error: "Unable to verify subscription status" },
        { status: 503 }
      ),
    };
  }

  const hasPaidPlan = !!activeEntitlement;
  const tier = (activeEntitlement?.tier as PlanTier | null | undefined) ?? null;

  return {
    hasPaidPlan,
    tier,
    entitlements: hasPaidPlan && tier ? getEntitlements(tier, area) : getFreeEntitlements(),
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

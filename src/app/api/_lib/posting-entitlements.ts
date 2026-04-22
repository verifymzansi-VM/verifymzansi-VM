import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { getEntitlements } from "@/lib/services/entitlements";
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

export async function getPostingEntitlementsOrResponse(
  supabase: EntitlementQueryClient,
  userId: string,
  area: MarketplaceArea,
  log: AppLogger
): Promise<PostingEntitlementsResult> {
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
  const activeTier = (activeEntitlement?.tier as PlanTier | null | undefined) ?? null;

  return {
    entitlements:
      hasPaidPlan && activeTier
        ? getEntitlements(activeTier as PlanTier, area)
        : {
            maxPhotos: FREE_POST_CONFIG.maxPhotos,
            maxVideos: FREE_POST_CONFIG.maxVideos,
            videoAllowed: FREE_POST_CONFIG.videoAllowed,
          },
  };
}

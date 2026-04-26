"use client";

import { useMemo } from "react";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { getEntitlements, type Entitlements } from "@/lib/services/entitlements";
import type { PlanTier, MarketplaceArea } from "@/types/enums";

const DEFAULT_ENTITLEMENTS: Entitlements = {
  maxAllowed: FREE_POST_CONFIG.maxAllowed,
  maxPhotos: FREE_POST_CONFIG.maxPhotos,
  maxVideos: FREE_POST_CONFIG.maxVideos,
  maxPostsPerMonth: FREE_POST_CONFIG.maxAllowed,
  videoAllowed: FREE_POST_CONFIG.videoAllowed,
  boostAllowed: false,
  featuredAllowed: false,
  urgentAllowed: false,
};

/**
 * Hook providing plan entitlements (limits, features) for a given tier and area.
 */
export function useEntitlements(
  planTier: PlanTier = "basic",
  area: MarketplaceArea = "MZANSI_MARKET"
) {
  const entitlements = useMemo(() => getEntitlements(planTier, area), [planTier, area]);

  return {
    planTier,
    entitlements: entitlements || DEFAULT_ENTITLEMENTS,
    canBoost: entitlements?.boostAllowed ?? false,
    canFeature: entitlements?.featuredAllowed ?? false,
    canUploadVideo: entitlements?.videoAllowed ?? false,
    maxPhotos: entitlements?.maxPhotos ?? 3,
    maxListings: entitlements?.maxAllowed ?? 2,
  };
}

"use client";

import { useMemo } from "react";
import { getEntitlements, type Entitlements } from "@/lib/services/entitlements";
import type { PlanTier, MarketplaceArea } from "@/types/enums";

const DEFAULT_ENTITLEMENTS: Entitlements = {
  maxAllowed: 2,
  maxPhotos: 3,
  maxVideos: 0,
  maxPostsPerMonth: 2,
  videoAllowed: false,
  boostAllowed: false,
  featuredAllowed: false,
  urgentAllowed: false,
  coverVideoAllowed: false,
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

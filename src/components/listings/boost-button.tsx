"use client";

import { Zap } from "lucide-react";
import { AddonCheckoutButton } from "@/components/listings/addon-checkout-button";

interface BoostButtonProps {
  listingId: string;
  isBoosted: boolean;
  canBoost: boolean;
  itemTypeLabel?: string;
  /** Override the API endpoint for boosting. Defaults to `/api/listings/${listingId}/boost` */
  boostApiPath?: string;
}

export function BoostButton({
  listingId,
  isBoosted,
  canBoost,
  itemTypeLabel = "listing",
  boostApiPath,
}: BoostButtonProps) {
  return (
    <AddonCheckoutButton
      apiPath={boostApiPath || `/api/listings/${listingId}/boost`}
      isActive={isBoosted}
      canUse={canBoost}
      activeTitle="Already boosted"
      unavailableTitle={`Upgrade to Growth or Pro to boost this ${itemTypeLabel}`}
      actionTitle={`Boost this ${itemTypeLabel} (R15 for 7 days)`}
      errorTitle="Boost failed"
      errorFallbackDescription="Failed to create boost checkout"
      hoverClassName="hover:text-brand-blue"
      activeIconClassName="text-brand-blue fill-brand-blue"
      Icon={Zap}
    />
  );
}

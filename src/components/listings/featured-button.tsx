"use client";

import { Star } from "lucide-react";
import { AddonCheckoutButton } from "@/components/listings/addon-checkout-button";

interface FeaturedButtonProps {
  listingId: string;
  isFeatured: boolean;
  canFeature: boolean;
  itemTypeLabel?: string;
  featuredApiPath?: string;
}

export function FeaturedButton({
  listingId,
  isFeatured,
  canFeature,
  itemTypeLabel = "listing",
  featuredApiPath,
}: FeaturedButtonProps) {
  return (
    <AddonCheckoutButton
      apiPath={featuredApiPath || `/api/listings/${listingId}/featured`}
      isActive={isFeatured}
      canUse={canFeature}
      activeTitle="Already featured"
      unavailableTitle={`Upgrade to Pro to feature this ${itemTypeLabel}`}
      actionTitle={`Feature this ${itemTypeLabel} (R25 for 7 days)`}
      errorTitle="Featured failed"
      errorFallbackDescription="Failed to create featured checkout"
      hoverClassName="hover:text-brand-gold"
      activeIconClassName="text-brand-gold fill-brand-gold"
      Icon={Star}
    />
  );
}

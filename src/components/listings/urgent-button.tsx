"use client";

import { AlertTriangle } from "lucide-react";
import { AddonCheckoutButton } from "@/components/listings/addon-checkout-button";

interface UrgentButtonProps {
  listingId: string;
  isUrgent: boolean;
  canMarkUrgent: boolean;
  itemTypeLabel?: string;
  /** Override the API endpoint for urgent. Defaults to `/api/listings/${listingId}/urgent` */
  urgentApiPath?: string;
}

export function UrgentButton({
  listingId,
  isUrgent,
  canMarkUrgent,
  itemTypeLabel = "listing",
  urgentApiPath,
}: UrgentButtonProps) {
  return (
    <AddonCheckoutButton
      apiPath={urgentApiPath || `/api/listings/${listingId}/urgent`}
      isActive={isUrgent}
      canUse={canMarkUrgent}
      activeTitle="Already urgent"
      unavailableTitle={`Upgrade to Pro to mark this ${itemTypeLabel} as urgent`}
      actionTitle={`Mark this ${itemTypeLabel} as urgent (R10 for 7 days)`}
      errorTitle="Urgent failed"
      errorFallbackDescription="Failed to create urgent checkout"
      hoverClassName="hover:text-red-500"
      activeIconClassName="text-red-500 fill-red-500"
      Icon={AlertTriangle}
    />
  );
}

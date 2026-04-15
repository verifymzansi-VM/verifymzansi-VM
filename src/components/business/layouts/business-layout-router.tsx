"use client";

import { hasBusinessDeliveryAvailable } from "@/lib/forms/business-type-details";
import type { TrustLevel } from "@/types/enums";
import type {
  BusinessDetailRecord,
  BusinessOwnerRecord,
  BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import type { LayoutTemplate } from "@/lib/business/layout-templates";
import { UnifiedLayout } from "@/components/business/layouts/unified-layout";
import { resolveBusinessProfileFamily } from "@/lib/presentation/profile-variants";

interface BusinessLayoutRouterProps {
  business: BusinessDetailRecord;
  trustLevel: TrustLevel | null;
  ownerProfile: BusinessOwnerRecord | null;
  promotions?: BusinessPromotionRecord[];
  showPromotions?: boolean;
  showPublicActions?: boolean;
  /** Kept for backward compat — single unified layout is always rendered (value is ignored). */
  layoutOverride?: LayoutTemplate;
}

/**
 * Renders the unified media-first business layout.
 *
 * Previously routed between cinematic / showcase / professional templates.
 * Now always renders `UnifiedLayout` (video → photos → compact details).
 * The `layoutOverride` prop is kept for backward compat but ignored.
 */
export function BusinessLayoutRouter({
  business,
  trustLevel,
  ownerProfile,
  promotions = [],
  showPromotions = true,
  showPublicActions = true,
}: BusinessLayoutRouterProps) {
  const galleryPhotos = business.gallery_photos ?? [];
  const deliveryAvailable = hasBusinessDeliveryAvailable(
    business.delivery_options,
    business.business_details
  );
  const family = resolveBusinessProfileFamily(
    business.category as Parameters<typeof resolveBusinessProfileFamily>[0],
    business.business_type as Parameters<typeof resolveBusinessProfileFamily>[1],
    business.subcategory
  );

  return (
    <UnifiedLayout
      family={family}
      business={business}
      trustLevel={trustLevel}
      ownerProfile={ownerProfile}
      promotions={promotions}
      showPromotions={showPromotions}
      showPublicActions={showPublicActions}
      galleryPhotos={galleryPhotos}
      deliveryAvailable={deliveryAvailable}
    />
  );
}

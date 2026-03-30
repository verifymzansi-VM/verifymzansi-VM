"use client";

import { resolveBusinessLayout } from "@/lib/business/category-layout-map";
import { hasBusinessDeliveryAvailable } from "@/lib/forms/business-type-details";
import type { BusinessCategory, TrustLevel } from "@/types/enums";
import type {
  BusinessDetailRecord,
  BusinessOwnerRecord,
  BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import type { LayoutTemplate } from "@/lib/business/layout-templates";
import { CinematicLayout } from "@/components/business/layouts/cinematic-layout";
import { ShowcaseLayout } from "@/components/business/layouts/showcase-layout";
import { ProfessionalLayout } from "@/components/business/layouts/professional-layout";

interface BusinessLayoutRouterProps {
  business: BusinessDetailRecord;
  trustLevel: TrustLevel | null;
  ownerProfile: BusinessOwnerRecord | null;
  promotions?: BusinessPromotionRecord[];
  showPromotions?: boolean;
  showPublicActions?: boolean;
  /** Override the resolved layout (used in preview / chooser). */
  layoutOverride?: LayoutTemplate;
}

/**
 * Resolves the correct layout template for a business and renders it.
 *
 * Resolution order:
 *  1. `layoutOverride` prop (preview / chooser)
 *  2. `business.layout_template` (user-chosen, persisted)
 *  3. category default (from CATEGORY_LAYOUT_MAP)
 */
export function BusinessLayoutRouter({
  business,
  trustLevel,
  ownerProfile,
  promotions = [],
  showPromotions = true,
  showPublicActions = true,
  layoutOverride,
}: BusinessLayoutRouterProps) {
  const template: LayoutTemplate =
    layoutOverride ??
    resolveBusinessLayout(business.layout_template, business.category as BusinessCategory);

  const galleryPhotos = business.gallery_photos ?? [];
  const deliveryAvailable = hasBusinessDeliveryAvailable(
    business.delivery_options,
    business.business_details
  );

  const common = {
    business,
    trustLevel,
    ownerProfile,
    promotions,
    showPromotions,
    showPublicActions,
    galleryPhotos,
    deliveryAvailable,
  } as const;

  switch (template) {
    case "cinematic":
      return <CinematicLayout {...common} />;
    case "showcase":
      return <ShowcaseLayout {...common} />;
    case "professional":
      return <ProfessionalLayout {...common} />;
    default:
      return <ProfessionalLayout {...common} />;
  }
}

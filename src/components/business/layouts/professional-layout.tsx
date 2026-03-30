"use client";

import Image from "next/image";
import { Store } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { BusinessPromoVideo } from "@/components/listings/business-promo-video";
import { PromotionCard } from "@/components/listings/promotion-card";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { CATEGORY_CTA_CONFIG } from "@/lib/business/category-layout-map";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import type { BusinessCategory, BusinessType, PromotionType, TrustLevel } from "@/types/enums";
import {
  BusinessDetailsCard,
  type BusinessDetailRecord,
  type BusinessOwnerRecord,
  type BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import { BusinessHeroIdentity } from "@/components/business/shared/business-hero-identity";
import { BusinessContactSection } from "@/components/business/shared/business-contact-section";
import { BusinessServicesSection } from "@/components/business/shared/business-services-section";
import { StickyContactBar } from "@/components/business/shared/sticky-contact-bar";
import {
  OperatingHoursCard,
  ManagedByCard,
  ShareReportRow,
} from "@/components/business/shared/business-sidebar-cards";
import { BusinessPaymentDeliverySection } from "@/components/business/shared/business-payment-delivery-section";

interface ProfessionalLayoutProps {
  business: BusinessDetailRecord;
  trustLevel: TrustLevel | null;
  ownerProfile: BusinessOwnerRecord | null;
  promotions: BusinessPromotionRecord[];
  showPromotions: boolean;
  showPublicActions: boolean;
  galleryPhotos: string[];
  deliveryAvailable: boolean;
}

/**
 * **Professional Layout**
 *
 * Structured card-based grid with clear visual hierarchy.
 * Cover photo header → identity → two-column (info + sidebar) → video in dedicated card → promotions.
 * Best for: trade, professional services, education, general.
 */
export function ProfessionalLayout({
  business,
  trustLevel,
  ownerProfile,
  promotions,
  showPromotions,
  showPublicActions,
  galleryPhotos,
  deliveryAvailable,
}: ProfessionalLayoutProps) {
  const ctaConfig = CATEGORY_CTA_CONFIG[business.category as BusinessCategory];
  const hasVideo = Boolean(business.cover_video);
  const opHours = business.operating_hours;

  return (
    <>
      {/* ═══ HEADER: Compact cover banner ═══ */}
      <div className="relative -mx-4 overflow-hidden rounded-2xl sm:-mx-0">
        <div className="relative aspect-[4/1] overflow-hidden bg-muted md:aspect-[5/1]">
          {business.cover_photo ? (
            <Image
              src={normalizeMediaUrl(business.cover_photo)}
              alt={`${business.business_name} cover`}
              fill
              className="object-cover"
              priority
              sizes="100vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-900 dark:to-slate-800">
              <Store className="h-12 w-12 text-muted-foreground/30" />
            </div>
          )}
        </div>
      </div>

      {/* Identity below banner */}
      <div className="-mt-8 relative z-10 px-4 sm:px-0">
        <BusinessHeroIdentity
          business={business}
          variant="below"
          primaryCtaLabel={ctaConfig?.primaryCta}
        />
      </div>

      {/* ═══ CONTENT: Structured two-column ═══ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          {/* About */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="font-display text-xl font-bold">About {business.business_name}</h2>
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {business.description || "No description provided."}
              </p>
            </CardContent>
          </Card>

          {/* Business Details */}
          <BusinessDetailsCard
            business={business}
            businessType={business.business_type as BusinessType}
            businessDetails={business.business_details}
            serviceAreas={business.service_areas}
          />

          {/* Services */}
          {business.services_offered && business.services_offered.length > 0 && (
            <BusinessServicesSection
              services={business.services_offered}
              heading={ctaConfig?.servicesHeading}
            />
          )}

          <BusinessPaymentDeliverySection
            paymentMethods={business.payment_methods_accepted}
            deliveryAvailable={deliveryAvailable}
          />

          {/* Video in a dedicated card */}
          {hasVideo && (
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 font-display text-lg font-bold">Business Video</h3>
                <BusinessPromoVideo
                  videoUrl={normalizeMediaUrl(business.cover_video!)}
                  thumbnailUrl={
                    business.video_thumbnail
                      ? normalizeMediaUrl(business.video_thumbnail)
                      : undefined
                  }
                  businessName={business.business_name}
                />
              </CardContent>
            </Card>
          )}

          {/* Gallery */}
          {galleryPhotos.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 font-display text-lg font-bold">
                  {ctaConfig?.galleryHeading ?? "Gallery"}
                </h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {galleryPhotos.map((url, i) => (
                    <div key={i} className="relative aspect-square overflow-hidden rounded-lg">
                      <Image
                        src={normalizeMediaUrl(url)}
                        alt={`${business.business_name} photo ${i + 1}`}
                        fill
                        className="object-cover"
                        sizes="(min-width: 640px) 25vw, 33vw"
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Promotions */}
          {showPromotions && promotions.length > 0 && (
            <div className="space-y-4">
              <h3 className="px-1 font-display text-xl font-bold">Promotions & Offers</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {promotions.map((promo) => (
                  <PromotionCard
                    key={promo.id}
                    id={promo.id}
                    title={promo.title}
                    price={promo.price_cents}
                    negotiable={promo.price_negotiable}
                    imageUrl={promo.videos?.[0] || promo.photos?.[0]}
                    posterUrl={promo.video_thumbnail || promo.photos?.[0] || undefined}
                    categoryLabel={getPromotionCategoryDisplayLabel(
                      promo.category_key,
                      promo.category
                    )}
                    province={promo.location_province}
                    city={promo.location_city}
                    promotionType={promo.promotion_type as PromotionType}
                    createdAt={promo.created_at}
                    viewCount={promo.view_count ?? undefined}
                    boosted={promo.boost_until ? new Date(promo.boost_until) > new Date() : false}
                    featured={
                      promo.featured_until ? new Date(promo.featured_until) > new Date() : false
                    }
                    endDate={promo.end_date}
                    logoUrl={business.logo_url}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <BusinessContactSection business={business} />
          {opHours && Object.keys(opHours).length > 0 && (
            <OperatingHoursCard operatingHours={opHours} />
          )}
          <ManagedByCard ownerProfile={ownerProfile} trustLevel={trustLevel} />
          <ShareReportRow business={business} showPublicActions={showPublicActions} />
        </div>
      </div>

      {showPublicActions && (
        <StickyContactBar business={business} ctaLabel={ctaConfig?.primaryCta} />
      )}
    </>
  );
}

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

interface ShowcaseLayoutProps {
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
 * **Showcase Layout**
 *
 * Gallery-forward grid with video as the first tile.
 * Cover photo header → identity below → masonry gallery (video first) → details.
 * Best for: electronics, groceries, home & living, automotive.
 */
export function ShowcaseLayout({
  business,
  trustLevel,
  ownerProfile,
  promotions,
  showPromotions,
  showPublicActions,
  galleryPhotos,
  deliveryAvailable,
}: ShowcaseLayoutProps) {
  const ctaConfig = CATEGORY_CTA_CONFIG[business.category as BusinessCategory];
  const hasVideo = Boolean(business.cover_video);
  const opHours = business.operating_hours;

  return (
    <>
      {/* ═══ HEADER: Cover photo with subtle overlay ═══ */}
      <div className="relative -mx-4 overflow-hidden rounded-2xl sm:-mx-0">
        <div className="relative aspect-[3/1] overflow-hidden bg-muted">
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
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
              <Store className="h-16 w-16 text-primary/30" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        </div>
      </div>

      {/* Identity below cover */}
      <div className="-mt-10 relative z-10 px-4 sm:px-0">
        <BusinessHeroIdentity
          business={business}
          variant="below"
          primaryCtaLabel={ctaConfig?.primaryCta}
        />
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="space-y-6">
        {/* Gallery grid: video as first tile, then photos */}
        {(hasVideo || galleryPhotos.length > 0) && (
          <div>
            <h2 className="mb-3 font-display text-lg font-bold">
              {ctaConfig?.galleryHeading ?? "Gallery"}
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {/* Video as first large tile */}
              {hasVideo && (
                <div className="col-span-2 md:col-span-1 md:row-span-2">
                  <BusinessPromoVideo
                    videoUrl={normalizeMediaUrl(business.cover_video!)}
                    thumbnailUrl={
                      business.video_thumbnail
                        ? normalizeMediaUrl(business.video_thumbnail)
                        : undefined
                    }
                    businessName={business.business_name}
                  />
                </div>
              )}
              {/* Gallery photos fill remaining space */}
              {galleryPhotos.map((url, i) => (
                <div
                  key={i}
                  className="relative aspect-square overflow-hidden rounded-xl shadow-sm"
                >
                  <Image
                    src={normalizeMediaUrl(url)}
                    alt={`${business.business_name} photo ${i + 1}`}
                    fill
                    className="object-cover transition-transform hover:scale-105"
                    sizes="(min-width: 768px) 33vw, 50vw"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* About */}
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="font-display text-xl font-bold">About {business.business_name}</h2>
            <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {business.description || "No description provided."}
            </p>
          </CardContent>
        </Card>

        {/* Two-column details + sidebar */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <BusinessDetailsCard
              business={business}
              businessType={business.business_type as BusinessType}
              businessDetails={business.business_details}
              serviceAreas={business.service_areas}
            />

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

          <div className="space-y-6">
            <BusinessContactSection business={business} />
            {opHours && Object.keys(opHours).length > 0 && (
              <OperatingHoursCard operatingHours={opHours} />
            )}
            <ManagedByCard ownerProfile={ownerProfile} trustLevel={trustLevel} />
            <ShareReportRow business={business} showPublicActions={showPublicActions} />
          </div>
        </div>
      </div>

      {showPublicActions && (
        <StickyContactBar business={business} ctaLabel={ctaConfig?.primaryCta} />
      )}
    </>
  );
}

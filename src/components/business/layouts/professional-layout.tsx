"use client";

import { useState } from "react";
import Image from "next/image";
import { Play, Store } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { BusinessPromoVideo } from "@/components/listings/business-promo-video";
import { PromotionCard } from "@/components/listings/promotion-card";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { CATEGORY_CTA_CONFIG } from "@/lib/business/category-layout-map";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import type { BusinessCategory, BusinessType, PromotionType, TrustLevel } from "@/types/enums";
import {
  type BusinessDetailRecord,
  type BusinessOwnerRecord,
  type BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import { BusinessHeroIdentity } from "@/components/business/shared/business-hero-identity";
import { StickyContactBar } from "@/components/business/shared/sticky-contact-bar";
import { ManagedByCard, ShareReportRow } from "@/components/business/shared/business-sidebar-cards";
import { BusinessDetailsAccordion } from "@/components/business/shared/business-details-accordion";

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
 * Clean, organized layout with visual hero → gallery → compact details.
 * Video/cover hero → thumbnail strip → identity → truncated about → accordion details.
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
  const mediaItems = [
    ...(hasVideo
      ? [
          {
            kind: "video" as const,
            url: business.cover_video!,
            poster: business.video_thumbnail || business.cover_photo || undefined,
          },
        ]
      : []),
    ...galleryPhotos.map((url, index) => ({
      kind: "photo" as const,
      url,
      photoNumber: index + 1,
    })),
  ];
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [isAboutExpanded, setIsAboutExpanded] = useState(false);
  const activeMedia = mediaItems[activeMediaIndex] ?? null;

  return (
    <>
      {/* ═══ HERO: Video-first or cover photo ═══ */}
      <div className="relative -mx-4 overflow-hidden rounded-2xl sm:-mx-0">
        <div className="relative aspect-[16/9] overflow-hidden bg-muted">
          {activeMedia ? (
            activeMedia.kind === "video" ? (
              <BusinessPromoVideo
                videoUrl={normalizeMediaUrl(activeMedia.url)}
                thumbnailUrl={
                  activeMedia.poster ? normalizeMediaUrl(activeMedia.poster) : undefined
                }
                businessName={business.business_name}
              />
            ) : (
              <Image
                src={normalizeMediaUrl(activeMedia.url)}
                alt={`${business.business_name} photo ${activeMedia.photoNumber ?? 1}`}
                fill
                className="object-cover"
                priority
                sizes="100vw"
              />
            )
          ) : business.cover_photo ? (
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

      {/* ═══ GALLERY THUMBNAILS ═══ */}
      {mediaItems.length > 1 && (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
          {mediaItems.map((item, i) => (
            <button
              key={`${item.kind}-${i}`}
              type="button"
              onClick={() => setActiveMediaIndex(i)}
              className={`relative aspect-square overflow-hidden rounded-lg border-2 ${
                activeMediaIndex === i ? "border-brand-blue" : "border-transparent"
              }`}
              aria-label={
                item.kind === "video"
                  ? "View profile video"
                  : `View photo ${item.photoNumber ?? i + 1}`
              }
            >
              {item.kind === "video" ? (
                <>
                  {item.poster || business.cover_photo ? (
                    <Image
                      src={normalizeMediaUrl(item.poster || business.cover_photo!)}
                      alt={`${business.business_name} video thumbnail`}
                      fill
                      className="object-cover"
                      sizes="100px"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-black text-white text-xs">
                      Video
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/30" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Play className="h-4 w-4 text-white fill-white" />
                  </div>
                </>
              ) : (
                <Image
                  src={normalizeMediaUrl(item.url)}
                  alt={`${business.business_name} photo ${item.photoNumber ?? i + 1}`}
                  fill
                  className="object-cover"
                  sizes="100px"
                />
              )}
            </button>
          ))}
        </div>
      )}

      {/* ═══ IDENTITY ═══ */}
      <BusinessHeroIdentity
        business={business}
        variant="below"
        primaryCtaLabel={ctaConfig?.primaryCta}
      />

      {/* ═══ CONTENT ═══ */}
      <div className="space-y-5">
        {/* About – truncated */}
        <Card>
          <CardContent className="space-y-3 p-5">
            <h2 className="font-display text-lg font-bold">About {business.business_name}</h2>
            <p
              className={`whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground ${
                !isAboutExpanded ? "line-clamp-3" : ""
              }`}
            >
              {business.description || "No description provided."}
            </p>
            {business.description && business.description.length > 120 && (
              <button
                type="button"
                onClick={() => setIsAboutExpanded(!isAboutExpanded)}
                className="text-sm font-medium text-brand-blue hover:underline"
              >
                {isAboutExpanded ? "Show less" : "Read more"}
              </button>
            )}
          </CardContent>
        </Card>

        {/* Collapsible details accordion */}
        <BusinessDetailsAccordion
          business={business}
          businessType={business.business_type as BusinessType}
          businessDetails={business.business_details}
          serviceAreas={business.service_areas}
          servicesOffered={business.services_offered ?? []}
          servicesHeading={ctaConfig?.servicesHeading}
          paymentMethods={business.payment_methods_accepted}
          deliveryAvailable={deliveryAvailable}
          operatingHours={opHours}
        />

        {/* Two-column: promotions + sidebar */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
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

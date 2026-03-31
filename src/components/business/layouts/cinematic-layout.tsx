"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Play, Store, Volume2, VolumeX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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

interface CinematicLayoutProps {
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
 * **Cinematic Layout**
 *
 * Full-bleed video hero → overlay identity → content cards.
 * Video is the PRIMARY element: autoplay, fills entire hero.
 * Best for: fashion, beauty, food, events.
 */
export function CinematicLayout({
  business,
  trustLevel,
  ownerProfile,
  promotions,
  showPromotions,
  showPublicActions,
  galleryPhotos,
  deliveryAvailable,
}: CinematicLayoutProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = Boolean(business.cover_video);
  const ctaConfig = CATEGORY_CTA_CONFIG[business.category as BusinessCategory];
  const opHours = business.operating_hours;
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAboutExpanded, setIsAboutExpanded] = useState(false);
  const [activeHero, setActiveHero] = useState<"video" | "cover-photo" | "gallery-photo">(
    hasVideo ? "video" : business.cover_photo ? "cover-photo" : "gallery-photo"
  );
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  const activePhotoUrl =
    activeHero === "cover-photo"
      ? business.cover_photo
      : galleryPhotos[activePhotoIndex] || business.cover_photo;

  function toggleMute() {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  }

  function handlePlay() {
    if (videoRef.current) {
      videoRef.current.play();
      setIsPlaying(true);
    }
  }

  return (
    <>
      {/* ═══ HERO: Full-bleed video/cover ═══ */}
      <div className="relative -mx-4 overflow-hidden rounded-2xl sm:-mx-0">
        <div className="relative aspect-[16/9] overflow-hidden bg-black md:aspect-[21/9]">
          {activeHero === "video" && hasVideo ? (
            <>
              <video
                ref={videoRef}
                src={normalizeMediaUrl(business.cover_video!)}
                poster={
                  business.video_thumbnail
                    ? normalizeMediaUrl(business.video_thumbnail)
                    : business.cover_photo
                      ? normalizeMediaUrl(business.cover_photo)
                      : undefined
                }
                autoPlay
                muted
                loop
                playsInline
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                className="absolute inset-0 h-full w-full object-cover"
                aria-label={`${business.business_name} promo video`}
              />

              {/* Play overlay */}
              {!isPlaying && (
                <button
                  type="button"
                  onClick={handlePlay}
                  className="absolute inset-0 z-10 flex items-center justify-center bg-black/20"
                  aria-label="Play video"
                >
                  <div className="rounded-full bg-white/90 p-4 shadow-xl backdrop-blur-sm">
                    <Play className="h-8 w-8 text-black fill-black" />
                  </div>
                </button>
              )}

              {/* Mute toggle */}
              <button
                type="button"
                onClick={toggleMute}
                className="absolute bottom-4 right-4 z-20 rounded-full bg-black/60 p-2.5 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
            </>
          ) : activePhotoUrl ? (
            <Image
              src={normalizeMediaUrl(activePhotoUrl)}
              alt={`${business.business_name} Cover`}
              fill
              className="object-cover"
              priority
              sizes="100vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-blue via-brand-blue/80 to-brand-blue/60">
              <Store className="h-24 w-24 text-white/30" />
            </div>
          )}

          {/* Gradient overlay for text legibility */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        </div>

        {/* Identity overlay at bottom of hero */}
        <div className="absolute inset-x-0 bottom-0">
          <BusinessHeroIdentity
            business={business}
            variant="overlay"
            hideCallCta
            primaryCtaLabel={ctaConfig?.primaryCta}
          />
        </div>
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="space-y-6">
        {/* Gallery as horizontal stories-style scroll */}
        {galleryPhotos.length > 0 && (
          <div className="-mx-4 sm:-mx-0">
            <div className="flex gap-3 overflow-x-auto px-4 pb-2 pt-1 snap-x snap-mandatory scrollbar-hide sm:px-0">
              {hasVideo && (
                <button
                  type="button"
                  onClick={() => setActiveHero("video")}
                  className={`relative flex-none w-32 h-32 rounded-2xl overflow-hidden snap-center shadow-md border-2 ${
                    activeHero === "video" ? "border-brand-blue" : "border-transparent"
                  }`}
                  aria-label="View profile video"
                >
                  {business.video_thumbnail || business.cover_photo ? (
                    <Image
                      src={normalizeMediaUrl(business.video_thumbnail || business.cover_photo!)}
                      alt={`${business.business_name} video thumbnail`}
                      fill
                      className="object-cover"
                      sizes="128px"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-black text-white text-xs">
                      Video
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/30" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Play className="h-5 w-5 text-white fill-white" />
                  </div>
                </button>
              )}
              {galleryPhotos.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setActivePhotoIndex(i);
                    setActiveHero("gallery-photo");
                  }}
                  className={`relative flex-none w-32 h-32 rounded-2xl overflow-hidden snap-center shadow-md border-2 ${
                    activeHero !== "video" && activePhotoUrl === url
                      ? "border-brand-blue"
                      : "border-transparent"
                  }`}
                  aria-label={`View photo ${i + 1}`}
                >
                  <Image
                    src={normalizeMediaUrl(url)}
                    alt={`${business.business_name} photo ${i + 1}`}
                    fill
                    className="object-cover"
                    sizes="128px"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* About – truncated */}
        <Card className="border-none bg-background/60 shadow-md backdrop-blur-sm">
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

      {/* Sticky mobile contact bar */}
      {showPublicActions && (
        <StickyContactBar business={business} ctaLabel={ctaConfig?.primaryCta} />
      )}
    </>
  );
}

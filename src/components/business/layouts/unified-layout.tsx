"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { MapPin, Maximize2, Play, Store, Volume2, VolumeX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PromotionCard } from "@/components/listings/promotion-card";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { CATEGORY_CTA_CONFIG } from "@/lib/business/category-layout-map";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import {
  BUSINESS_CATEGORY_LABELS,
  BUSINESS_TYPE_LABELS,
  type BusinessCategory,
  type BusinessType,
  type PromotionType,
  type TrustLevel,
} from "@/types/enums";
import {
  type BusinessDetailRecord,
  type BusinessOwnerRecord,
  type BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import { StickyContactBar } from "@/components/business/shared/sticky-contact-bar";
import { ManagedByCard, ShareReportRow } from "@/components/business/shared/business-sidebar-cards";
import { BusinessDetailsAccordion } from "@/components/business/shared/business-details-accordion";
import { MediaLightbox } from "@/components/ui/media-lightbox";

interface UnifiedLayoutProps {
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
 * **Unified Layout** — Media-first, mobile-based business profile.
 *
 * Hierarchy: Video hero → Gallery grid → Compact identity → Description → Details (collapsed).
 * The video/photos are the primary communication. Logo is small, details are minimal.
 */
export function UnifiedLayout({
  business,
  trustLevel,
  ownerProfile,
  promotions,
  showPromotions,
  showPublicActions,
  galleryPhotos,
  deliveryAvailable,
}: UnifiedLayoutProps) {
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
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStart, setLightboxStart] = useState(0);
  const wasPlayingRef = useRef(false);

  // Include cover_photo in lightbox items if not already in galleryPhotos
  const lightboxItems = (() => {
    const items = galleryPhotos.map((url) => ({ url, kind: "photo" as const }));
    if (business.cover_photo && !galleryPhotos.includes(business.cover_photo)) {
      items.unshift({ url: business.cover_photo, kind: "photo" as const });
    }
    return items;
  })();

  function openLightbox(idx: number) {
    const v = videoRef.current;
    wasPlayingRef.current = v ? !v.paused : false;
    setLightboxStart(idx);
    setLightboxOpen(true);
    v?.pause();
  }

  function closeLightbox() {
    setLightboxOpen(false);
    if (videoRef.current && wasPlayingRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }

  function enterFullscreen() {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (v.requestFullscreen) {
        v.requestFullscreen();
      } else if (
        (v as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen
      ) {
        (v as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
      }
    } catch {
      /* fullscreen not supported */
    }
  }

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

  const businessType = business.business_type as BusinessType;
  const businessCategory = business.category as BusinessCategory;

  return (
    <>
      {/* ═══ HERO: Full-bleed video/cover ═══ */}
      <div className="relative overflow-hidden rounded-2xl">
        <div className="relative aspect-[4/5] overflow-hidden bg-black sm:aspect-[16/9]">
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
              {!isPlaying && (
                <button
                  type="button"
                  onClick={handlePlay}
                  className="absolute inset-0 z-10 flex items-center justify-center bg-black/20"
                  aria-label="Play video"
                >
                  <div className="rounded-full bg-white/90 p-4 shadow-xl backdrop-blur-sm">
                    <Play className="h-8 w-8 fill-black text-black" />
                  </div>
                </button>
              )}
              <button
                type="button"
                onClick={toggleMute}
                className="absolute bottom-4 right-4 z-20 rounded-full bg-black/60 p-2.5 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={enterFullscreen}
                className="absolute bottom-4 right-16 z-20 rounded-full bg-black/60 p-2.5 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
                aria-label="Fullscreen"
              >
                <Maximize2 className="h-5 w-5" />
              </button>
            </>
          ) : activePhotoUrl ? (
            <button
              type="button"
              className="relative w-full h-full cursor-zoom-in"
              onClick={() => {
                const idx = lightboxItems.findIndex((item) => item.url === activePhotoUrl);
                openLightbox(idx >= 0 ? idx : 0);
              }}
              aria-label={`View ${business.business_name} photo fullscreen`}
            >
              <Image
                src={normalizeMediaUrl(activePhotoUrl)}
                alt={`${business.business_name} Cover`}
                fill
                className="object-cover"
                priority
                sizes="100vw"
              />
              <div className="absolute bottom-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm">
                <Maximize2 className="h-5 w-5" />
              </div>
            </button>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-blue via-brand-blue/80 to-brand-blue/60">
              <Store className="h-24 w-24 text-white/30" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        </div>
      </div>

      {/* ═══ GALLERY: Thumbnail grid ═══ */}
      {(galleryPhotos.length > 0 || hasVideo) && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {hasVideo && (
            <button
              type="button"
              onClick={() => setActiveHero("video")}
              className={`group relative aspect-square overflow-hidden rounded-xl ring-2 transition-all ${
                activeHero === "video" ? "ring-brand-blue shadow-md" : "ring-transparent"
              }`}
              aria-label="View profile video"
            >
              {business.video_thumbnail || business.cover_photo ? (
                <Image
                  src={normalizeMediaUrl(business.video_thumbnail || business.cover_photo!)}
                  alt="Video thumbnail"
                  fill
                  className="object-cover transition-transform group-hover:scale-105"
                  sizes="(max-width: 640px) 33vw, 25vw"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-black text-xs text-white">
                  Video
                </div>
              )}
              <div className="absolute inset-0 bg-black/25" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-full bg-white/90 p-2 shadow-lg backdrop-blur-sm">
                  <Play className="h-4 w-4 fill-black text-black" />
                </div>
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
              className={`group relative aspect-square overflow-hidden rounded-xl ring-2 transition-all ${
                activeHero !== "video" && activePhotoUrl === url
                  ? "ring-brand-blue shadow-md"
                  : "ring-transparent"
              }`}
              aria-label={`View photo ${i + 1}`}
            >
              <Image
                src={normalizeMediaUrl(url)}
                alt={`${business.business_name} photo ${i + 1}`}
                fill
                className="object-cover transition-transform group-hover:scale-105"
                sizes="(max-width: 640px) 33vw, 25vw"
              />
            </button>
          ))}
        </div>
      )}

      {/* ═══ COMPACT IDENTITY BAR ═══ */}
      <div className="mt-4 flex items-center gap-3">
        {/* Small logo */}
        <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg border bg-white p-0.5 dark:bg-warm-900">
          {business.logo_url ? (
            <Image
              src={normalizeMediaUrl(business.logo_url)}
              alt={`${business.business_name} Logo`}
              width={40}
              height={40}
              className="h-full w-full rounded-md object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-md bg-muted">
              <Store className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
        {/* Name + meta */}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg font-bold text-foreground">
            {business.business_name}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {BUSINESS_TYPE_LABELS[businessType]}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {BUSINESS_CATEGORY_LABELS[businessCategory]}
            </Badge>
            {(business.location_city || business.location_province) && (
              <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {[business.location_city, business.location_province].filter(Boolean).join(", ")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ═══ ABOUT — minimal ═══ */}
      {business.description && (
        <div className="mt-4 space-y-1">
          <p
            className={`whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground ${
              !isAboutExpanded ? "line-clamp-2" : ""
            }`}
          >
            {business.description}
          </p>
          {business.description.length > 100 && (
            <button
              type="button"
              onClick={() => setIsAboutExpanded(!isAboutExpanded)}
              className="text-sm font-medium text-brand-blue hover:underline"
            >
              {isAboutExpanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}

      {/* ═══ DETAILS — collapsed accordion ═══ */}
      <div className="mt-4">
        <BusinessDetailsAccordion
          business={business}
          businessType={businessType}
          businessDetails={business.business_details}
          serviceAreas={business.service_areas}
          servicesOffered={business.services_offered ?? []}
          servicesHeading={ctaConfig?.servicesHeading}
          paymentMethods={business.payment_methods_accepted}
          deliveryAvailable={deliveryAvailable}
          operatingHours={opHours}
        />
      </div>

      {/* ═══ PROMOTIONS + SIDEBAR ═══ */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {showPromotions && promotions.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display text-lg font-bold">Promotions & Offers</h3>
              <div className="grid grid-cols-2 gap-3">
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
        <div className="space-y-4">
          <ManagedByCard ownerProfile={ownerProfile} trustLevel={trustLevel} />
          <ShareReportRow business={business} showPublicActions={showPublicActions} />
        </div>
      </div>

      {/* ═══ STICKY MOBILE CONTACT BAR ═══ */}
      {showPublicActions && (
        <StickyContactBar business={business} ctaLabel={ctaConfig?.primaryCta} />
      )}

      {/* ═══ MEDIA LIGHTBOX ═══ */}
      <MediaLightbox
        items={lightboxItems}
        startIndex={lightboxStart}
        isOpen={lightboxOpen}
        onClose={closeLightbox}
      />
    </>
  );
}

"use client";
import { getBusinessVenuePhotoUrls } from "@/lib/business/venue-photos";
import { CustomerAccessSummary } from "@/components/business/customer-access-summary";

import { VideoViewTracker } from "@/components/ui/video-view-tracker";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  Globe,
  MapPin,
  Maximize2,
  Play,
  MessageSquare,
  Store,
} from "lucide-react";
import { ContentContactActions } from "@/components/listings/content-contact-actions";
import { businessContactConfig } from "@/components/listings/contact-action-configs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  TourismDetailsCard,
  type BusinessDetailRecord,
  type BusinessOwnerRecord,
  type BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import { StickyContactBar } from "@/components/business/shared/sticky-contact-bar";
import { ManagedByCard } from "@/components/business/shared/business-sidebar-cards";
import { BusinessDetailsAccordion } from "@/components/business/shared/business-details-accordion";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { ProfileVideoPlayer } from "@/components/ui/profile-video-player";
import { PromotionCard } from "@/components/listings/promotion-card";
import { safeExternalHref } from "@/lib/utils/sanitize-html";
import type { TourismCategoryDetails } from "@/types/tourism-details";
import { getCategoryDetailFields } from "@/lib/forms/business-category-details";
import type { BusinessProfileFamily } from "@/lib/presentation/profile-variants";
import { useHorizontalSwipeNavigation } from "@/hooks/use-horizontal-swipe-navigation";
import { useTrackContentView } from "@/hooks/use-track-content-view";
import { useHydrated } from "@/hooks/use-hydrated";
import { contactPhone } from "@/lib/utils/contact-links";
import { humanizeKey } from "@/lib/presentation/listing-facts";
import {
  acceptsInboxEnquiries,
  getBusinessProfileFacts,
  getBusinessVerificationFacts,
  getBusinessQuickFacts,
  getSubcategoryLabel,
  getTourismSpotlightFacts,
  SOCIAL_LABELS,
} from "@/lib/presentation/business-facts";
import { placeLine } from "@/lib/utils/place-line";
import { BusinessStickers } from "@/components/trust/business-stickers";
import { ID_REVIEWED_TRUST_LEVEL } from "@/lib/business-verification/public";

interface UnifiedLayoutProps {
  family: BusinessProfileFamily;
  business: BusinessDetailRecord;
  trustLevel: TrustLevel | null;
  ownerProfile: BusinessOwnerRecord | null;
  promotions: BusinessPromotionRecord[];
  showPromotions: boolean;
  showPublicActions: boolean;
  layoutMode?: "public" | "review";
  galleryPhotos: string[];
  deliveryAvailable: boolean;
}

interface BusinessHeroMediaItem {
  kind: "video" | "photo";
  key: string;
  url: string;
  poster?: string;
  label: string;
}

function SectionCard({
  title,
  body,
  lead,
}: {
  title: string;
  body: React.ReactNode;
  /** Optional content above the section heading (e.g. the page title). */
  lead?: React.ReactNode;
}) {
  return (
    <Card className="surface-card elev-sm">
      <CardContent className="space-y-3 p-5">
        {lead}
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        {body}
      </CardContent>
    </Card>
  );
}

function MediaColumn({
  family,
  business,
  galleryPhotos,
  layoutMode,
  onViewRecorded,
}: {
  family: BusinessProfileFamily;
  business: BusinessDetailRecord;
  galleryPhotos: string[];
  layoutMode: "public" | "review";
  onViewRecorded: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const heroMediaItems = useMemo<BusinessHeroMediaItem[]>(() => {
    const items: BusinessHeroMediaItem[] = [];
    const normalizedPoster =
      business.video_thumbnail || business.cover_photo
        ? normalizeMediaUrl((business.video_thumbnail || business.cover_photo)!)
        : undefined;

    if (business.cover_video) {
      items.push({
        kind: "video",
        key: "video",
        url: normalizeMediaUrl(business.cover_video),
        poster: normalizedPoster,
        label: "profile video",
      });
    }

    if (business.cover_photo) {
      items.push({
        kind: "photo",
        key: `cover:${business.cover_photo}`,
        url: normalizeMediaUrl(business.cover_photo),
        label: "cover photo",
      });
    }

    galleryPhotos.forEach((photo, index) => {
      const normalizedPhoto = normalizeMediaUrl(photo);
      if (items.some((item) => item.kind === "photo" && item.url === normalizedPhoto)) {
        return;
      }

      items.push({
        kind: "photo",
        key: `gallery:${normalizedPhoto}:${index}`,
        url: normalizedPhoto,
        label: `photo ${index + 1}`,
      });
    });

    return items;
  }, [business.cover_photo, business.cover_video, business.video_thumbnail, galleryPhotos]);
  const lightboxItems = useMemo(
    () =>
      heroMediaItems
        .filter((item) => item.kind === "photo")
        .map((item) => ({ url: item.url, kind: "photo" as const })),
    [heroMediaItems]
  );
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStart, setLightboxStart] = useState(0);
  const wasPlayingRef = useRef(false);
  const activeMedia = heroMediaItems[activeMediaIndex] ?? null;
  const canPrevious = activeMediaIndex > 0;
  const canNext = activeMediaIndex < heroMediaItems.length - 1;
  const goToPreviousMedia = useCallback(() => {
    setActiveMediaIndex((current) => Math.max(current - 1, 0));
  }, []);
  const goToNextMedia = useCallback(() => {
    setActiveMediaIndex((current) => Math.min(current + 1, heroMediaItems.length - 1));
  }, [heroMediaItems.length]);
  const swipeHandlers = useHorizontalSwipeNavigation({
    canPrevious,
    canNext,
    onPrevious: goToPreviousMedia,
    onNext: goToNextMedia,
  });

  const columnWidthClass =
    family === "professional"
      ? `mx-auto w-full max-w-[300px] sm:max-w-[320px] ${
          layoutMode === "review" ? "2xl:max-w-none" : "lg:max-w-none"
        }`
      : family === "tourism"
        ? `mx-auto w-full max-w-[310px] sm:max-w-[330px] ${
            layoutMode === "review" ? "2xl:max-w-none" : "lg:max-w-none"
          }`
        : `mx-auto w-full max-w-[290px] sm:max-w-[310px] ${
            layoutMode === "review" ? "2xl:max-w-none" : "lg:max-w-none"
          }`;

  function openLightbox(idx: number) {
    const video = videoRef.current;
    wasPlayingRef.current = video ? !video.paused : false;
    setLightboxStart(idx);
    setLightboxOpen(true);
    video?.pause();
  }

  function closeLightbox() {
    setLightboxOpen(false);
    if (videoRef.current && wasPlayingRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }

  function openActivePhotoInLightbox() {
    if (!activeMedia || activeMedia.kind !== "photo") {
      return;
    }

    const photoIndex = lightboxItems.findIndex((item) => item.url === activeMedia.url);
    openLightbox(photoIndex >= 0 ? photoIndex : 0);
  }

  return (
    <div className="space-y-3">
      <div className={columnWidthClass}>
        <div className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-slate-950 shadow-[0_35px_80px_-48px_rgba(15,23,42,0.55)] dark:border-white/10">
          <div className="relative aspect-[9/16] overflow-hidden touch-pan-y" {...swipeHandlers}>
            {activeMedia?.kind === "video" ? (
              <VideoViewTracker
                targetId={business.id}
                targetType="business"
                surface="detail"
                enabled={layoutMode === "public" && business.status === "live"}
                onRecorded={onViewRecorded}
              >
                <ProfileVideoPlayer
                  ref={videoRef}
                  src={activeMedia.url}
                  poster={activeMedia.poster}
                  prioritizePoster={activeMediaIndex === 0}
                  autoPlayOnMobile={false}
                  title={business.business_name}
                  mediaFit="contain"
                  videoClassName="object-contain"
                  skipSeconds={10}
                  showErrorState
                />
              </VideoViewTracker>
            ) : activeMedia?.kind === "photo" ? (
              <button
                type="button"
                className="relative h-full w-full cursor-zoom-in"
                onClick={openActivePhotoInLightbox}
                aria-label={`View ${business.business_name} media fullscreen`}
              >
                <Image
                  src={activeMedia.url}
                  alt=""
                  aria-hidden="true"
                  fill
                  // Blur backdrop is desktop-only: full-width Gaussian blur is a
                  // severe mobile GPU cost (see video-card-player SmartFitBackdrop).
                  className="absolute inset-0 scale-110 object-cover opacity-75 blur-none brightness-100 md:blur-2xl md:brightness-75 md:motion-reduce:blur-none"
                  sizes="(max-width: 1024px) 78vw, 420px"
                />
                <div className="absolute inset-0 bg-black/35" aria-hidden="true" />
                <Image
                  src={activeMedia.url}
                  alt={`${business.business_name} hero`}
                  fill
                  className="object-contain"
                  priority
                  sizes="(max-width: 1024px) 78vw, 420px"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
                <div className="absolute bottom-4 right-4 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm">
                  <Maximize2 className="h-4 w-4" />
                </div>
              </button>
            ) : (
              <div className="flex h-full items-center justify-center bg-gradient-to-br from-brand-blue/85 via-brand-blue to-slate-950">
                <Store className="h-16 w-16 text-white/35" />
              </div>
            )}

            {activeMedia?.kind !== "video" && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
                <div className="flex items-end gap-3">
                  <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/20 bg-white p-1 shadow-lg dark:bg-warm-900">
                    {business.logo_url ? (
                      <Image
                        src={normalizeMediaUrl(business.logo_url)}
                        alt={`${business.business_name} logo`}
                        width={56}
                        height={56}
                        className="h-full w-full rounded-xl object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <Store className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-left text-white">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/70">
                      {family === "tourism"
                        ? "Tourism & Hospitality"
                        : family === "professional"
                          ? "Business Profile"
                          : "Featured Profile"}
                    </p>
                    {/* Decorative repeat of the name; the page heading lives in the details column. */}
                    <p className="line-clamp-2 font-display text-2xl font-semibold leading-tight">
                      {business.business_name}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {heroMediaItems.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={goToPreviousMedia}
                  disabled={!canPrevious}
                  className="absolute left-3 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white shadow-lg transition hover:bg-black/70 disabled:pointer-events-none disabled:opacity-35"
                  aria-label="Previous media"
                  data-carousel-control="true"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={goToNextMedia}
                  disabled={!canNext}
                  className="absolute right-3 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white shadow-lg transition hover:bg-black/70 disabled:pointer-events-none disabled:opacity-35"
                  aria-label="Next media"
                  data-carousel-control="true"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {heroMediaItems.length > 1 && (
        <div className="mx-auto flex max-w-[520px] gap-2 overflow-x-auto pb-1 lg:max-w-none">
          {heroMediaItems.map((item, index) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveMediaIndex(index)}
              className={`group relative aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-2xl ring-2 transition-all ${
                index === activeMediaIndex ? "ring-brand-blue shadow-md" : "ring-transparent"
              }`}
              aria-label={`View ${item.label}`}
              aria-current={index === activeMediaIndex ? "true" : undefined}
              data-carousel-control="true"
            >
              {item.kind === "video" ? (
                <>
                  {item.poster ? (
                    <Image
                      src={item.poster}
                      alt="Profile video thumbnail"
                      fill
                      className="object-cover transition-transform group-hover:scale-105"
                      sizes="80px"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-950 text-white/70">
                      <Play className="h-5 w-5" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/25" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="rounded-full bg-white/90 p-2 shadow-lg backdrop-blur-sm">
                      <Play className="h-4 w-4 fill-black text-black" />
                    </div>
                  </div>
                </>
              ) : (
                <Image
                  src={item.url}
                  alt={`${business.business_name} ${item.label}`}
                  fill
                  className="object-cover"
                  sizes="80px"
                />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Full-screen plays count as views too. */}
      <VideoViewTracker
        targetId={business.id}
        targetType="business"
        surface="lightbox"
        enabled={layoutMode === "public" && business.status === "live"}
        onRecorded={onViewRecorded}
      >
        <MediaLightbox
          items={lightboxItems}
          startIndex={lightboxStart}
          isOpen={lightboxOpen}
          onClose={closeLightbox}
        />
      </VideoViewTracker>
    </div>
  );
}

export function UnifiedLayout({
  family,
  business,
  trustLevel,
  ownerProfile,
  promotions,
  showPromotions,
  showPublicActions,
  layoutMode = "public",
  galleryPhotos,
  deliveryAvailable,
}: UnifiedLayoutProps) {
  const [viewCount, setViewCount] = useState(business.view_count ?? 0);
  const handleViewRecorded = useCallback(() => {
    setViewCount((currentCount) => currentCount + 1);
  }, []);
  useTrackContentView(
    business.id,
    "business",
    layoutMode === "public" && business.status === "live",
    handleViewRecorded
  );
  const isReviewLayout = layoutMode === "review";
  // Create/edit previews already have a page h1.
  const TitleTag = isReviewLayout ? "h2" : "h1";
  // Boost/feature flags depend on "now": read the clock only after hydration.
  const isHydrated = useHydrated();
  // eslint-disable-next-line react-hooks/purity -- read the clock only after hydration
  const nowMs = isHydrated ? Date.now() : null;
  const isActiveUntil = (value: string | null | undefined) =>
    nowMs != null && Boolean(value) && new Date(value!).getTime() > nowMs;
  const businessType = business.business_type as BusinessType;
  const businessCategory = business.category as BusinessCategory;
  const typeLabel =
    BUSINESS_TYPE_LABELS[businessType] ??
    (business.business_type ? humanizeKey(business.business_type) : null);
  const categoryLabel = BUSINESS_CATEGORY_LABELS[businessCategory] ?? null;
  const subcategoryLabel = getSubcategoryLabel(business.category, business.subcategory);
  const ctaConfig = CATEGORY_CTA_CONFIG[businessCategory];
  const quickFacts = getBusinessQuickFacts(family, business, deliveryAvailable, promotions);
  // Tourism already shows languages in the spotlight section — skip duplicate.
  const profileFacts = getBusinessProfileFacts(business, {
    includeLanguages: family !== "tourism",
  });
  const verificationFacts = getBusinessVerificationFacts(business);
  const tourismDetails = (business.category_details ?? {}) as Record<string, unknown>;
  const venuePhotos = getBusinessVenuePhotoUrls(
    business.business_details,
    business.category_details
  );
  const bookingUrl =
    family === "tourism" && typeof tourismDetails.booking_url === "string"
      ? tourismDetails.booking_url
      : null;
  const servicesHeading =
    family === "tourism"
      ? "Stay & Experience"
      : family === "professional"
        ? "Service Scope"
        : ctaConfig?.servicesHeading;
  const showStickyContactBar = layoutMode === "public" && showPublicActions;
  const shellClassName = isReviewLayout
    ? "grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] 2xl:items-start"
    : showStickyContactBar &&
        (contactPhone(business.phone) ||
          contactPhone(business.whatsapp) ||
          business.contact_available?.phone ||
          business.contact_available?.whatsapp)
      ? "grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(18rem,20rem)] lg:items-start lg:pb-0"
      : "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(18rem,20rem)] lg:items-start";
  const viewCountLabel = `${viewCount} ${viewCount === 1 ? "view" : "views"}`;

  const introBody = (
    <div className="space-y-4">
      <BusinessStickers
        size="md"
        state={{
          idReviewed: trustLevel != null && trustLevel >= ID_REVIEWED_TRUST_LEVEL,
          cipcCheckedAt: business.cipc_verified_at,
          seenAt: business.seen_verified_at,
          seenMethod: business.seen_method,
          seenCity: business.seen_city,
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {typeLabel && family !== "tourism" ? (
          <Badge variant="outline" className="text-[11px]">
            {typeLabel}
          </Badge>
        ) : null}
        {categoryLabel ? (
          <Badge variant="secondary" className="text-[11px]">
            {categoryLabel}
          </Badge>
        ) : null}
        {subcategoryLabel ? (
          <Badge variant="secondary" className="bg-primary/10 text-[11px] text-primary">
            {subcategoryLabel}
          </Badge>
        ) : null}
      </div>

      {(business.location_city || business.location_province || business.location_town) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 text-brand-blue" />
          <span>
            {placeLine([
              business.location_town,
              business.location_city,
              business.location_province,
            ])}
          </span>
        </div>
      )}

      {business.location_address ? (
        <p className="text-sm text-muted-foreground">{business.location_address}</p>
      ) : null}

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Eye className="h-4 w-4 text-brand-blue" />
        <span>{viewCountLabel}</span>
      </div>

      {business.description ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {business.description}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[...quickFacts, ...verificationFacts, ...profileFacts].map((fact) => (
          <div
            key={`${fact.label}-${fact.value}`}
            className="rounded-2xl border border-slate-200/70 bg-slate-50/90 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {fact.label}
            </p>
            <p className="mt-1 text-sm font-medium">{fact.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {family === "tourism" && bookingUrl ? (
          <Button asChild className="gap-2">
            <a
              href={safeExternalHref(bookingUrl)}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
            >
              <CalendarDays className="h-4 w-4" />
              {ctaConfig?.primaryCta ?? "Book Now"}
            </a>
          </Button>
        ) : business.website ? (
          <Button asChild className="gap-2">
            <a
              href={safeExternalHref(business.website)}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
            >
              <Globe className="h-4 w-4" />
              Visit website
            </a>
          </Button>
        ) : null}

        {business.map_directions ? (
          <Button asChild variant="outline" className="gap-2">
            <a
              href={safeExternalHref(business.map_directions)}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
            >
              <MapPin className="h-4 w-4" />
              Open map
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );

  const spotlightBody =
    family === "tourism" ? (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {getTourismSpotlightFacts(tourismDetails).map((fact) => (
            <div
              key={fact.label}
              className={
                fact.wide
                  ? "rounded-2xl bg-muted/40 p-3 sm:col-span-2"
                  : "rounded-2xl bg-muted/40 p-3"
              }
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {fact.label}
              </p>
              <p className="mt-1 text-sm font-medium">{fact.value}</p>
            </div>
          ))}
        </div>
      </div>
    ) : family === "professional" ? (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-muted/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Service model
          </p>
          <p className="mt-1 text-sm font-medium">{typeLabel ?? "Not listed"}</p>
        </div>
        <div className="rounded-2xl bg-muted/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Delivery
          </p>
          <p className="mt-1 text-sm font-medium">
            {deliveryAvailable ? "Available for customers" : "Not listed"}
          </p>
        </div>
      </div>
    ) : (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-muted/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Photos and videos
          </p>
          <p className="mt-1 text-sm font-medium">
            {galleryPhotos.length > 0
              ? `${galleryPhotos.length} supporting photos`
              : "Hero-led presentation"}
          </p>
        </div>
        <div className="rounded-2xl bg-muted/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Live offers
          </p>
          <p className="mt-1 text-sm font-medium">
            {promotions.length > 0
              ? `${promotions.length} Tourism & Events posts visible`
              : "No live posts yet"}
          </p>
        </div>
      </div>
    );

  const hasSpotlight =
    family !== "tourism" ||
    [
      "tgcsa_grading",
      "minimum_stay_nights",
      "child_policy",
      "seasonal_pricing",
      "nearby_attractions",
    ].some((key) => {
      const value = tourismDetails[key];
      return Array.isArray(value) ? value.length > 0 : typeof value === "number" || Boolean(value);
    });

  const infoColumn = (
    <div className="space-y-5">
      <SectionCard
        lead={
          <TitleTag className="break-words font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
            {business.business_name}
          </TitleTag>
        }
        title="About"
        body={introBody}
      />

      {hasSpotlight ? (
        <SectionCard
          title={
            family === "tourism"
              ? "Stay details"
              : family === "professional"
                ? "Working details"
                : "Products and offers"
          }
          body={spotlightBody}
        />
      ) : null}

      {family === "tourism" ? (
        <TourismDetailsCard details={tourismDetails as TourismCategoryDetails} />
      ) : null}
      {/* Tourism details are already shown in full by TourismDetailsCard above. */}
      {family !== "tourism" &&
      getCategoryDetailFields(businessCategory).some((field) => {
        const value = business.category_details?.[field.name];
        return value != null && value !== "" && (!Array.isArray(value) || value.length > 0);
      }) ? (
        <SectionCard
          title="More details"
          body={
            <dl className="grid gap-4 sm:grid-cols-2">
              {getCategoryDetailFields(businessCategory).map((field) => {
                const value = business.category_details?.[field.name];
                if (value == null || value === "" || (Array.isArray(value) && !value.length))
                  return null;
                const format = (item: unknown) =>
                  field.options?.find((option) => option.value === item)?.label ??
                  String(item).replace(/_/g, " ");
                return (
                  <div key={field.name}>
                    <dt className="text-sm text-muted-foreground">{field.label}</dt>
                    <dd className="whitespace-pre-wrap break-words text-sm font-medium">
                      {typeof value === "boolean"
                        ? value
                          ? "Yes"
                          : "No"
                        : Array.isArray(value)
                          ? value.map(format).join(", ")
                          : format(value)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          }
        />
      ) : null}

      <CustomerAccessSummary
        value={business.category_details?.customer_access}
        meetingPoint={business.category_details?.meeting_point}
      />
      {venuePhotos.length > 0 ? (
        <SectionCard
          title="Finding us"
          body={
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {venuePhotos.map((url, index) => (
                <li
                  key={url}
                  className="aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={normalizeMediaUrl(url)}
                    alt={`Entrance or landmark photo ${index + 1}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </li>
              ))}
            </ul>
          }
        />
      ) : null}
      <BusinessDetailsAccordion
        business={business}
        businessType={businessType}
        businessDetails={business.business_details}
        serviceAreas={business.service_areas}
        servicesOffered={business.services_offered ?? []}
        servicesHeading={servicesHeading}
        paymentMethods={business.payment_methods_accepted}
        deliveryAvailable={deliveryAvailable}
        operatingHours={business.operating_hours}
      />

      {showPromotions && promotions.length > 0 ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Active posts
            </p>
            <h2 className="font-display text-xl font-semibold">Tourism & Events posts</h2>
          </div>
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
                categoryLabel={getPromotionCategoryDisplayLabel(promo.category_key, promo.category)}
                province={promo.location_province}
                city={promo.location_city}
                promotionType={promo.promotion_type as PromotionType}
                createdAt={promo.created_at}
                viewCount={promo.view_count ?? undefined}
                boosted={isActiveUntil(promo.boost_until)}
                featured={isActiveUntil(promo.featured_until)}
                endDate={promo.end_date}
                logoUrl={business.logo_url}
                focalX={promo.focal_x}
                focalY={promo.focal_y}
                mediaWidth={promo.media_width}
                mediaHeight={promo.media_height}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <div className={shellClassName} data-layout-mode={layoutMode} data-profile-family={family}>
        <MediaColumn
          family={family}
          business={business}
          galleryPhotos={galleryPhotos}
          layoutMode={layoutMode}
          onViewRecorded={handleViewRecorded}
        />

        <div className="space-y-5">{infoColumn}</div>

        <div className={isReviewLayout ? "space-y-4 2xl:col-span-2" : "space-y-4"}>
          <ManagedByCard
            ownerProfile={ownerProfile}
            trustLevel={trustLevel}
            position={business.owner_position_title ?? null}
            positionSource={business.owner_verified_role ?? null}
          />
          <Card className="surface-card elev-sm">
            <CardContent className="space-y-4 p-5">
              <h2 className="font-display text-lg font-semibold">Contact</h2>

              <div className="space-y-2 text-sm">
                {Object.entries(business.social_links ?? {})
                  .filter(([, url]) => Boolean(url))
                  .map(([platform, url]) => (
                    <a
                      key={platform}
                      href={safeExternalHref(url)}
                      target="_blank"
                      rel="noopener noreferrer nofollow ugc"
                      className="block rounded-xl border px-3 py-2"
                    >
                      {SOCIAL_LABELS[platform] ?? humanizeKey(platform)}
                    </a>
                  ))}
                {business.email ? (
                  <a
                    href={`mailto:${business.email}`}
                    className="block break-all rounded-xl border px-3 py-2"
                  >
                    {business.email}
                  </a>
                ) : null}
                {business.website ? (
                  <a
                    href={safeExternalHref(business.website)}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    className="flex items-center gap-2 rounded-xl border px-3 py-2"
                  >
                    <Globe className="h-4 w-4 text-brand-blue" />
                    <span className="font-medium">Visit public website</span>
                  </a>
                ) : null}
                {business.map_directions ? (
                  <a
                    href={safeExternalHref(business.map_directions)}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    className="flex items-center gap-2 rounded-xl border px-3 py-2"
                  >
                    <MapPin className="h-4 w-4 text-brand-blue" />
                    <span className="font-medium">Open location</span>
                  </a>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {business.services_offered?.map((service, index) => (
                  <Badge key={`${service}-${index}`} variant="outline">
                    {service}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {showPublicActions ? (
            <Card id="contact" className="scroll-mt-24">
              <CardContent className="space-y-3 p-5">
                <ContentContactActions
                  phone={business.phone}
                  whatsapp={business.whatsapp}
                  revealable={
                    business.contact_available && !business.phone && !business.whatsapp
                      ? {
                          phone: business.contact_available.phone,
                          whatsapp: business.contact_available.whatsapp,
                        }
                      : null
                  }
                  showPhoneButton={true}
                  showMessageButton={acceptsInboxEnquiries(business.category_details)}
                  messageIcon={MessageSquare}
                  config={businessContactConfig(
                    business.id,
                    business.business_name,
                    `${family === "tourism" ? "/tourism-events" : "/mzansi-business"}/${business.id}`
                  )}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {showStickyContactBar ? (
        <StickyContactBar business={business} ctaLabel={ctaConfig?.primaryCta ?? "Call Now"} />
      ) : null}
    </>
  );
}

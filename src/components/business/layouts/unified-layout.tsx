"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { CalendarDays, Globe, MapPin, Maximize2, Play, ShieldCheck, Store } from "lucide-react";
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
  type BusinessDetailRecord,
  type BusinessOwnerRecord,
  type BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import { StickyContactBar } from "@/components/business/shared/sticky-contact-bar";
import {
  ManagedByCard,
  OperatingHoursCard,
  ShareReportRow,
} from "@/components/business/shared/business-sidebar-cards";
import { BusinessDetailsAccordion } from "@/components/business/shared/business-details-accordion";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { ProfileVideoPlayer } from "@/components/ui/profile-video-player";
import { PromotionCard } from "@/components/listings/promotion-card";
import { safeExternalHref } from "@/lib/utils/sanitize-html";
import type { BusinessProfileFamily } from "@/lib/presentation/profile-variants";
import { useHorizontalSwipeNavigation } from "@/hooks/use-horizontal-swipe-navigation";

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

interface QuickFact {
  label: string;
  value: string;
}

interface BusinessHeroMediaItem {
  kind: "video" | "photo";
  key: string;
  url: string;
  poster?: string;
  label: string;
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function getTourismQuickFacts(business: BusinessDetailRecord): QuickFact[] {
  const details = (business.category_details ?? {}) as Record<string, unknown>;
  const facts: QuickFact[] = [];

  if (typeof details.price_range === "string") {
    facts.push({ label: "Price Range", value: details.price_range.replace(/_/g, " ") });
  }
  if (typeof details.number_of_rooms === "number") {
    facts.push({ label: "Rooms / Units", value: String(details.number_of_rooms) });
  }
  if (typeof details.check_in_time === "string") {
    facts.push({ label: "Check-in", value: details.check_in_time });
  }
  if (typeof details.check_out_time === "string") {
    facts.push({ label: "Check-out", value: details.check_out_time });
  }
  if (typeof details.tour_duration === "string") {
    facts.push({ label: "Tour Duration", value: details.tour_duration.replace(/_/g, " ") });
  }
  if (typeof details.visit_duration === "string") {
    facts.push({ label: "Visit Duration", value: details.visit_duration.replace(/_/g, " ") });
  }
  if (typeof details.max_group_size === "number") {
    facts.push({ label: "Group Size", value: `${details.max_group_size} guests` });
  }

  return facts.slice(0, 6);
}

function getBusinessQuickFacts(
  family: BusinessProfileFamily,
  business: BusinessDetailRecord,
  deliveryAvailable: boolean,
  promotions: BusinessPromotionRecord[]
): QuickFact[] {
  const servicesCount = business.services_offered?.length ?? 0;
  const galleryCount = business.gallery_photos?.length ?? 0;
  const paymentCount = business.payment_methods_accepted?.length ?? 0;
  const serviceAreaCount = business.service_areas?.areas?.length ?? 0;

  if (family === "tourism") {
    return getTourismQuickFacts(business);
  }

  if (family === "professional") {
    return [
      serviceAreaCount > 0 ? { label: "Service Areas", value: `${serviceAreaCount} listed` } : null,
      servicesCount > 0 ? { label: "Services", value: `${servicesCount} offered` } : null,
      deliveryAvailable ? { label: "Delivery", value: "Available" } : null,
      business.map_directions ? { label: "Directions", value: "Map link available" } : null,
      business.website ? { label: "Website", value: "Public website" } : null,
    ].filter((fact): fact is QuickFact => Boolean(fact));
  }

  return [
    galleryCount > 0 ? { label: "Gallery", value: `${galleryCount} photos` } : null,
    servicesCount > 0 ? { label: "Range", value: `${servicesCount} highlights` } : null,
    paymentCount > 0 ? { label: "Payments", value: `${paymentCount} supported` } : null,
    promotions.length > 0 ? { label: "Offers", value: `${promotions.length} live` } : null,
  ].filter((fact): fact is QuickFact => Boolean(fact));
}

function SectionCard({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <Card className="border-slate-200/75 bg-white/95 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-slate-950/75">
      <CardContent className="space-y-3 p-5">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {eyebrow}
          </p>
          <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
        </div>
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
}: {
  family: BusinessProfileFamily;
  business: BusinessDetailRecord;
  galleryPhotos: string[];
  layoutMode: "public" | "review";
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
  const swipeHandlers = useHorizontalSwipeNavigation({
    canPrevious,
    canNext,
    onPrevious: () => setActiveMediaIndex((current) => Math.max(current - 1, 0)),
    onNext: () =>
      setActiveMediaIndex((current) => Math.min(current + 1, heroMediaItems.length - 1)),
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
              <ProfileVideoPlayer
                ref={videoRef}
                src={activeMedia.url}
                poster={activeMedia.poster}
                title={business.business_name}
                mediaFit="contain"
                videoClassName="bg-slate-950 object-contain"
                skipSeconds={10}
                showErrorState
              />
            ) : activeMedia?.kind === "photo" ? (
              <button
                type="button"
                className="relative h-full w-full cursor-zoom-in"
                onClick={openActivePhotoInLightbox}
                aria-label={`View ${business.business_name} media fullscreen`}
              >
                <Image
                  src={activeMedia.url}
                  alt={`${business.business_name} hero`}
                  fill
                  className="bg-slate-950 object-contain"
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
                        ? "Verified Business"
                        : "Featured Profile"}
                  </p>
                  <h1 className="line-clamp-2 font-display text-2xl font-semibold leading-tight">
                    {business.business_name}
                  </h1>
                </div>
              </div>
            </div>
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
              data-carousel-control="true"
            >
              {item.kind === "video" ? (
                <>
                  {item.poster ? (
                    <Image
                      src={item.poster}
                      alt="Profile video thumbnail"
                      fill
                      className="bg-slate-950 object-contain transition-transform group-hover:scale-105"
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
                  className="bg-slate-950 object-contain"
                  sizes="80px"
                />
              )}
            </button>
          ))}
        </div>
      )}

      <MediaLightbox
        items={lightboxItems}
        startIndex={lightboxStart}
        isOpen={lightboxOpen}
        onClose={closeLightbox}
      />
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
  const isReviewLayout = layoutMode === "review";
  const businessType = business.business_type as BusinessType;
  const businessCategory = business.category as BusinessCategory;
  const ctaConfig = CATEGORY_CTA_CONFIG[businessCategory];
  const quickFacts = getBusinessQuickFacts(family, business, deliveryAvailable, promotions);
  const tourismDetails = (business.category_details ?? {}) as Record<string, unknown>;
  const amenityHighlights = normalizeList(tourismDetails.amenities).slice(0, 8);
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
    : showStickyContactBar && (business.phone || business.whatsapp)
      ? "grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(18rem,20rem)] lg:items-start lg:pb-0"
      : "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(18rem,20rem)] lg:items-start";

  const introBody = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[11px]">
          {BUSINESS_TYPE_LABELS[businessType]}
        </Badge>
        <Badge variant="secondary" className="text-[11px]">
          {BUSINESS_CATEGORY_LABELS[businessCategory]}
        </Badge>
        {business.subcategory ? (
          <Badge variant="secondary" className="bg-primary/10 text-[11px] text-primary">
            {business.subcategory.replace(/_/g, " ")}
          </Badge>
        ) : null}
      </div>

      {(business.location_city || business.location_province) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 text-brand-blue" />
          <span>
            {[business.location_town, business.location_city, business.location_province]
              .filter(Boolean)
              .join(", ")}
          </span>
        </div>
      )}

      {business.description ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {business.description}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {quickFacts.map((fact) => (
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
              Visit Website
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
              Open Map
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );

  const spotlightBody =
    family === "tourism" ? (
      <div className="space-y-3">
        {amenityHighlights.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {amenityHighlights.map((amenity) => (
              <Badge key={amenity} variant="outline">
                {amenity.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {typeof tourismDetails.languages_spoken === "string" ? (
            <div className="rounded-2xl bg-muted/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Languages
              </p>
              <p className="mt-1 text-sm font-medium">{tourismDetails.languages_spoken}</p>
            </div>
          ) : null}
          {typeof tourismDetails.cancellation_policy === "string" ? (
            <div className="rounded-2xl bg-muted/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Cancellation
              </p>
              <p className="mt-1 text-sm font-medium">
                {tourismDetails.cancellation_policy.replace(/_/g, " ")}
              </p>
            </div>
          ) : null}
          {normalizeList(tourismDetails.meal_options).length > 0 ? (
            <div className="rounded-2xl bg-muted/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Meal Options
              </p>
              <p className="mt-1 text-sm font-medium">
                {normalizeList(tourismDetails.meal_options).slice(0, 3).join(", ")}
              </p>
            </div>
          ) : null}
          {normalizeList(tourismDetails.activity_types).length > 0 ? (
            <div className="rounded-2xl bg-muted/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Activities
              </p>
              <p className="mt-1 text-sm font-medium">
                {normalizeList(tourismDetails.activity_types).slice(0, 3).join(", ")}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    ) : family === "professional" ? (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-muted/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Service Model
          </p>
          <p className="mt-1 text-sm font-medium">{BUSINESS_TYPE_LABELS[businessType]}</p>
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
            Visual Showcase
          </p>
          <p className="mt-1 text-sm font-medium">
            {galleryPhotos.length > 0
              ? `${galleryPhotos.length} supporting photos`
              : "Hero-led presentation"}
          </p>
        </div>
        <div className="rounded-2xl bg-muted/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Live Offers
          </p>
          <p className="mt-1 text-sm font-medium">
            {promotions.length > 0
              ? `${promotions.length} promotions visible`
              : "No live offers yet"}
          </p>
        </div>
      </div>
    );

  const infoColumn = (
    <div className="space-y-5">
      <SectionCard
        eyebrow={
          family === "tourism"
            ? "Plan Your Visit"
            : family === "professional"
              ? "Know The Business"
              : "Browse The Brand"
        }
        title={
          family === "tourism"
            ? "Booking, location, and what to expect"
            : family === "professional"
              ? "Trust signals and service clarity"
              : "A more visual profile for discovery"
        }
        body={introBody}
      />

      <SectionCard
        eyebrow={
          family === "tourism"
            ? "Guest Highlights"
            : family === "professional"
              ? "Working Details"
              : "Profile Focus"
        }
        title={
          family === "tourism"
            ? "Stay details, amenities, and experience cues"
            : family === "professional"
              ? "Operational details customers need first"
              : "Media, range, and offer rhythm"
        }
        body={spotlightBody}
      />

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
              Active Posts
            </p>
            <h3 className="font-display text-xl font-semibold">
              {family === "tourism" ? "Tourism Posts & Offers" : "Promotions & Offers"}
            </h3>
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
                boosted={promo.boost_until ? new Date(promo.boost_until) > new Date() : false}
                featured={
                  promo.featured_until ? new Date(promo.featured_until) > new Date() : false
                }
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
        />

        <div className="space-y-5">{infoColumn}</div>

        <div className={isReviewLayout ? "space-y-4 2xl:col-span-2" : "space-y-4"}>
          <ManagedByCard ownerProfile={ownerProfile} trustLevel={trustLevel} />
          {business.operating_hours ? (
            <OperatingHoursCard operatingHours={business.operating_hours} />
          ) : null}

          <Card className="border-slate-200/75 bg-white/95 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-slate-950/75">
            <CardContent className="space-y-4 p-5">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Contact
                </p>
                <h3 className="font-display text-lg font-semibold">
                  {family === "tourism" ? "Reach the host or venue" : "Reach the business"}
                </h3>
              </div>

              <div className="space-y-2 text-sm">
                {business.phone ? (
                  <a
                    href={`tel:${business.phone}`}
                    className="flex items-center gap-2 rounded-xl border px-3 py-2"
                  >
                    <ShieldCheck className="h-4 w-4 text-brand-green" />
                    <span className="font-medium">{business.phone}</span>
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
                {business.services_offered?.slice(0, 4).map((service) => (
                  <Badge key={service} variant="outline">
                    {service}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <ShareReportRow business={business} showPublicActions={showPublicActions} />
        </div>
      </div>

      {showStickyContactBar ? (
        <StickyContactBar business={business} ctaLabel={ctaConfig?.primaryCta ?? "Call Now"} />
      ) : null}
    </>
  );
}

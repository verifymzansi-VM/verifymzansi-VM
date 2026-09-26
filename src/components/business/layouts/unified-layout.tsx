"use client";

import { VideoViewTracker } from "@/components/ui/video-view-tracker";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  Globe,
  Mail,
  MapPin,
  Maximize2,
  Play,
  MessageSquare,
  Store,
} from "lucide-react";
import { ContentContactActions } from "@/components/listings/content-contact-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { BusinessDetailsAccordion } from "@/components/business/shared/business-details-accordion";
import {
  DetailSection,
  FactGrid,
  PosterTrustCard,
  SafetyTipsCard,
  type DetailFact,
} from "@/components/listings/detail-panels";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { ProfileVideoPlayer } from "@/components/ui/profile-video-player";
import { PromotionCard } from "@/components/listings/promotion-card";
import { safeExternalHref } from "@/lib/utils/sanitize-html";
import { cn } from "@/lib/utils";
import type { TourismCategoryDetails } from "@/types/tourism-details";
import { getCategoryDetailFields } from "@/lib/forms/business-category-details";
import { BUSINESS_CATEGORIES, TOURISM_SUBCATEGORIES } from "@/lib/constants/categories";
import type { BusinessProfileFamily } from "@/lib/presentation/profile-variants";
import { useHorizontalSwipeNavigation } from "@/hooks/use-horizontal-swipe-navigation";
import { useTrackContentView } from "@/hooks/use-track-content-view";

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

/** Turn a stored key such as `children_over_6` into readable text. */
function humanizeKey(value: string) {
  const text = value.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function getSubcategoryLabel(category: string, subcategory: string | null) {
  if (!subcategory) return null;
  const categoryDefinition = BUSINESS_CATEGORIES.find((item) => item.value === category);
  const match =
    categoryDefinition?.subcategories.find((item) => item.value === subcategory) ??
    TOURISM_SUBCATEGORIES.find((item) => item.value === subcategory);
  return match?.label ?? humanizeKey(subcategory);
}

/* ── Self-reported business profile extras (category_details.business_profile) ── */
const BBBEE_LEVEL_LABELS: Record<string, string> = {
  level_1: "Level 1",
  level_2: "Level 2",
  level_3: "Level 3",
  level_4: "Level 4",
  level_5: "Level 5",
  level_6: "Level 6",
  level_7: "Level 7",
  level_8: "Level 8",
  non_compliant: "Non-compliant",
  exempt: "Exempt (EME)",
};

const EMPLOYEE_COUNT_LABELS: Record<string, string> = {
  "1": "1 (solo)",
  "2_5": "2 – 5",
  "6_10": "6 – 10",
  "11_50": "11 – 50",
  "51_200": "51 – 200",
  "200_plus": "200+",
};

const CHILD_POLICY_LABELS: Record<string, string> = {
  children_welcome: "Children welcome",
  children_over_6: "Children 6+",
  children_over_12: "Children 12+",
  adults_only: "Adults only",
};

/**
 * Facts the owner entered under "Additional Business Details" in the create
 * form. The API folds them into `category_details.business_profile` — render
 * them so the form data actually reaches the public profile.
 */
function getBusinessProfileFacts(business: BusinessDetailRecord): DetailFact[] {
  const details = (business.category_details ?? {}) as Record<string, unknown>;
  const profile = details.business_profile;
  if (!profile || typeof profile !== "object") return [];
  const p = profile as Record<string, unknown>;
  const facts: DetailFact[] = [];

  if (typeof p.year_established === "number" && p.year_established > 0) {
    facts.push({ label: "Established", value: String(p.year_established) });
  }
  if (typeof p.number_of_employees === "string" && p.number_of_employees) {
    facts.push({
      label: "Team size",
      value: EMPLOYEE_COUNT_LABELS[p.number_of_employees] ?? p.number_of_employees,
    });
  }
  if (typeof p.bbbee_level === "string" && p.bbbee_level) {
    facts.push({ label: "B-BBEE", value: BBBEE_LEVEL_LABELS[p.bbbee_level] ?? p.bbbee_level });
  }
  if (typeof p.cipc_registration === "string" && p.cipc_registration) {
    facts.push({ label: "CIPC reg.", value: p.cipc_registration });
  }
  if (typeof p.languages_spoken === "string" && p.languages_spoken) {
    facts.push({ label: "Languages", value: p.languages_spoken });
  }
  if (p.load_shedding_ready === true) {
    facts.push({ label: "Load-shedding", value: "Backup power ready" });
  }

  return facts;
}

/**
 * Tourism facts that the shared TourismDetailsCard does not already cover, so
 * nothing is repeated between the two sections.
 */
function getTourismExtraFacts(details: Record<string, unknown>): DetailFact[] {
  const facts: DetailFact[] = [];
  if (typeof details.tgcsa_grading === "string" && details.tgcsa_grading) {
    facts.push({
      label: "TGCSA grading",
      value: humanizeKey(details.tgcsa_grading.replace(/_star$/, "-star")),
    });
  }
  if (typeof details.minimum_stay_nights === "number") {
    facts.push({
      label: "Minimum stay",
      value: `${details.minimum_stay_nights} ${details.minimum_stay_nights === 1 ? "night" : "nights"}`,
    });
  }
  if (typeof details.child_policy === "string" && details.child_policy) {
    facts.push({
      label: "Children",
      value: CHILD_POLICY_LABELS[details.child_policy] ?? humanizeKey(details.child_policy),
    });
  }
  if (details.seasonal_pricing === true) {
    facts.push({ label: "Seasonal pricing", value: "Peak and off-peak rates" });
  }
  if (typeof details.nearby_attractions === "string" && details.nearby_attractions) {
    facts.push({ label: "Nearby", value: details.nearby_attractions, wide: true });
  }
  return facts;
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
  const activeRing = family === "tourism" ? "border-sunset-600" : "border-brand-blue-600";

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
      <div className="relative overflow-hidden rounded-3xl bg-warm-950 elev-sm">
        <div
          className="relative aspect-[4/5] touch-pan-y overflow-hidden sm:aspect-[4/3]"
          {...swipeHandlers}
        >
          {activeMedia?.kind === "video" ? (
            <VideoViewTracker
              targetId={business.id}
              targetType="business"
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
              className="group relative h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
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
                className="absolute inset-0 hidden scale-110 object-cover opacity-60 md:block md:blur-2xl md:motion-reduce:blur-none"
                sizes="(max-width: 1024px) 100vw, 66vw"
              />
              <Image
                src={activeMedia.url}
                alt={`${business.business_name} ${activeMedia.label}`}
                fill
                className="object-contain"
                priority
                sizes="(max-width: 1024px) 100vw, 66vw"
              />
              <span className="absolute bottom-3 right-3 rounded-full bg-black/55 p-2 text-white transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </span>
            </button>
          ) : (
            <div
              className={cn(
                "flex h-full flex-col items-center justify-center gap-2 text-white/70",
                family === "tourism"
                  ? "bg-gradient-to-br from-sunset-600 to-warm-950"
                  : "bg-gradient-to-br from-brand-blue-600 to-warm-950"
              )}
            >
              <Store className="h-12 w-12" aria-hidden="true" />
              <p className="text-sm">No photos added yet</p>
            </div>
          )}

          {heroMediaItems.length > 1 ? (
            <>
              <span className="absolute left-3 top-3 z-20 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold tabular-nums text-white">
                {activeMediaIndex + 1} / {heroMediaItems.length}
              </span>
              <button
                type="button"
                onClick={goToPreviousMedia}
                disabled={!canPrevious}
                className="absolute left-3 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none disabled:opacity-0"
                aria-label="Previous media"
                data-carousel-control="true"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={goToNextMedia}
                disabled={!canNext}
                className="absolute right-3 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none disabled:opacity-0"
                aria-label="Next media"
                data-carousel-control="true"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {heroMediaItems.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {heroMediaItems.map((item, index) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveMediaIndex(index)}
              aria-current={index === activeMediaIndex ? "true" : undefined}
              className={cn(
                "group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 bg-warm-950 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-20 sm:w-20",
                index === activeMediaIndex
                  ? `${activeRing} shadow-md`
                  : "border-transparent opacity-70 hover:opacity-100"
              )}
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
                      className="object-cover"
                      sizes="80px"
                    />
                  ) : null}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <span className="rounded-full bg-white/90 p-1.5 shadow">
                      <Play className="h-3.5 w-3.5 fill-black text-black" aria-hidden="true" />
                    </span>
                  </span>
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

      <MediaLightbox
        items={lightboxItems}
        startIndex={lightboxStart}
        isOpen={lightboxOpen}
        onClose={closeLightbox}
      />
    </div>
  );
}

const PUBLIC_GRID =
  "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_24rem]";
const REVIEW_GRID =
  "grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-rows-[auto_1fr] 2xl:gap-x-8";

const SOCIAL_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "X (Twitter)",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  website: "Website",
};

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
  const isTourism = family === "tourism";
  const area = isTourism ? "tourism" : "business";
  const businessType = business.business_type as BusinessType;
  const businessCategory = business.category as BusinessCategory;
  const ctaConfig = CATEGORY_CTA_CONFIG[businessCategory];
  const typeLabel =
    BUSINESS_TYPE_LABELS[businessType] ??
    (business.business_type ? humanizeKey(business.business_type) : null);
  const categoryLabel = BUSINESS_CATEGORY_LABELS[businessCategory] ?? null;
  const subcategoryLabel = getSubcategoryLabel(business.category, business.subcategory);
  const tourismDetails = (business.category_details ?? {}) as Record<string, unknown>;
  const bookingUrl =
    isTourism && typeof tourismDetails.booking_url === "string" && tourismDetails.booking_url
      ? tourismDetails.booking_url
      : null;
  const servicesHeading = isTourism
    ? "Stay and experience"
    : family === "professional"
      ? "Services"
      : ctaConfig?.servicesHeading;
  const showStickyContactBar = layoutMode === "public" && showPublicActions;
  const hasStickyActions = showStickyContactBar && Boolean(business.phone || business.whatsapp);
  const viewCountLabel = `${viewCount} ${viewCount === 1 ? "view" : "views"}`;
  const locationLabel = [business.location_town, business.location_city, business.location_province]
    .filter(Boolean)
    .join(", ");
  const keyFacts: DetailFact[] = [
    ...(isTourism ? getTourismExtraFacts(tourismDetails) : []),
    ...getBusinessProfileFacts(business),
  ];
  const categoryDetailFacts: DetailFact[] = getCategoryDetailFields(businessCategory)
    .map((field) => {
      const value = business.category_details?.[field.name];
      if (value == null || value === "" || (Array.isArray(value) && !value.length)) return null;
      const format = (item: unknown) =>
        field.options?.find((option) => option.value === item)?.label ??
        (typeof item === "string" ? humanizeKey(item) : String(item));
      return {
        label: field.label,
        value:
          typeof value === "boolean"
            ? value
              ? "Yes"
              : "No"
            : Array.isArray(value)
              ? value.map(format).join(", ")
              : format(value),
        wide: typeof value === "string" && value.length > 40,
      } satisfies DetailFact;
    })
    .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact));
  const socialLinks = Object.entries(business.social_links ?? {}).filter(([, url]) => Boolean(url));
  const hasOtherContacts =
    socialLinks.length > 0 ||
    Boolean(business.email) ||
    Boolean(business.website) ||
    Boolean(business.map_directions);
  const TitleTag = isReviewLayout ? "h2" : "h1";
  const accentText = isTourism
    ? "text-sunset-700 dark:text-sunset-300"
    : "text-brand-blue-700 dark:text-brand-blue-300";

  const summary = (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-border bg-white p-1 dark:bg-warm-900">
          {business.logo_url ? (
            <Image
              src={normalizeMediaUrl(business.logo_url)}
              alt={`${business.business_name} logo`}
              width={56}
              height={56}
              className="h-full w-full rounded-xl object-contain"
            />
          ) : (
            <div
              className={cn(
                "flex h-full w-full items-center justify-center rounded-xl",
                isTourism ? "area-tourism-tile" : "area-business-tile"
              )}
            >
              <Store className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-1.5">
          <TitleTag className="font-display text-[1.6rem] font-bold leading-[1.15] tracking-tight text-foreground sm:text-[2rem]">
            {business.business_name}
          </TitleTag>
          {subcategoryLabel || categoryLabel ? (
            <p className={cn("text-sm font-semibold", accentText)}>
              {subcategoryLabel ?? categoryLabel}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {typeLabel ? (
          <Badge variant="outline" className="text-xs">
            {typeLabel}
          </Badge>
        ) : null}
        {categoryLabel && subcategoryLabel ? (
          <Badge variant="secondary" className="text-xs">
            {categoryLabel}
          </Badge>
        ) : null}
        {business.store_number && business.store_number !== "N/A" ? (
          <Badge variant="secondary" className="text-xs">
            Shop {business.store_number}
          </Badge>
        ) : null}
      </div>

      <ul className="space-y-1.5 text-sm text-muted-foreground">
        {locationLabel ? (
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {locationLabel}
              {business.location_address ? (
                <>
                  <br />
                  <span>{business.location_address}</span>
                </>
              ) : null}
            </span>
          </li>
        ) : business.location_address ? (
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{business.location_address}</span>
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{viewCountLabel}</span>
        </li>
      </ul>

      {bookingUrl || business.website || business.map_directions ? (
        <div className="flex flex-wrap gap-2">
          {bookingUrl ? (
            <Button asChild className="gap-2 bg-sunset-600 text-white hover:bg-sunset-700">
              <a
                href={safeExternalHref(bookingUrl)}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
              >
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                Book online
              </a>
            </Button>
          ) : business.website ? (
            <Button
              asChild
              className={cn(
                "gap-2 text-white",
                isTourism
                  ? "bg-sunset-600 hover:bg-sunset-700"
                  : "bg-brand-blue-600 hover:bg-brand-blue-700"
              )}
            >
              <a
                href={safeExternalHref(business.website)}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
              >
                <Globe className="h-4 w-4" aria-hidden="true" />
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
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Get directions
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const contactBlock = showPublicActions ? (
    <ContentContactActions
      phone={business.phone}
      whatsapp={business.whatsapp}
      showPhoneButton={true}
      showMessageButton={true}
      messageIcon={MessageSquare}
      config={{
        targetId: business.id,
        sharePath: `${isTourism ? "/tourism-events" : "/mzansi-business"}/${business.id}`,
        shareTitle: business.business_name,
        contactPayloadKey: "businessId",
        contactErrorFallback: "Failed to send enquiry",
        reportTargetType: "business",
        reportTitle: "Report profile",
        reportPlaceholder: "Describe the issue with this profile...",
        reportSuccessCopy: "Thank you. Our team will review this profile.",
        reportOptions: [
          { value: "misleading", label: "Inaccurate information" },
          { value: "scam", label: "Scam or fraud" },
          { value: "other", label: "Other" },
        ],
        messageTitle: `Enquire about ${business.business_name}`,
        messageDescription:
          "Your enquiry goes to the account holder’s inbox with your reply details.",
        messagePlaceholder: "Hi, I would like to know more...",
        messageSubmitLabel: "Send enquiry",
        messageSuccessCopy:
          "Your enquiry is in the account holder’s inbox. They can reply using the contact details you provided.",
      }}
    />
  ) : (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Preview mode</p>
      <p>Contact buttons appear once approved.</p>
    </div>
  );

  const otherContacts = hasOtherContacts ? (
    <DetailSection title="Contact details" headingLevel="h2">
      <ul className="space-y-2 text-sm">
        {business.email ? (
          <li>
            <a
              href={`mailto:${business.email}`}
              className="flex min-h-11 items-center gap-3 break-all rounded-xl border border-border px-3 py-2 transition-colors hover:bg-muted"
            >
              <Mail className={cn("h-4 w-4 shrink-0", accentText)} aria-hidden="true" />
              {business.email}
            </a>
          </li>
        ) : null}
        {business.website ? (
          <li>
            <a
              href={safeExternalHref(business.website)}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 py-2 transition-colors hover:bg-muted"
            >
              <Globe className={cn("h-4 w-4 shrink-0", accentText)} aria-hidden="true" />
              <span className="font-medium">Visit public website</span>
            </a>
          </li>
        ) : null}
        {business.map_directions ? (
          <li>
            <a
              href={safeExternalHref(business.map_directions)}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 py-2 transition-colors hover:bg-muted"
            >
              <MapPin className={cn("h-4 w-4 shrink-0", accentText)} aria-hidden="true" />
              <span className="font-medium">Open location</span>
            </a>
          </li>
        ) : null}
        {socialLinks.map(([platform, url]) => (
          <li key={platform}>
            <a
              href={safeExternalHref(url)}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 py-2 font-medium transition-colors hover:bg-muted"
            >
              <Globe className={cn("h-4 w-4 shrink-0", accentText)} aria-hidden="true" />
              {SOCIAL_LABELS[platform] ?? humanizeKey(platform)}
            </a>
          </li>
        ))}
      </ul>
    </DetailSection>
  ) : null;

  return (
    <>
      <div
        className={cn(
          isReviewLayout ? REVIEW_GRID : PUBLIC_GRID,
          hasStickyActions && "pb-24 lg:pb-0"
        )}
        data-layout-mode={layoutMode}
        data-profile-family={family}
      >
        <div
          className={cn(
            "min-w-0",
            isReviewLayout ? "2xl:col-start-1 2xl:row-start-1" : "lg:col-start-1 lg:row-start-1"
          )}
        >
          <MediaColumn
            family={family}
            business={business}
            galleryPhotos={galleryPhotos}
            layoutMode={layoutMode}
            onViewRecorded={handleViewRecorded}
          />
        </div>

        <aside
          className={cn(
            "min-w-0",
            isReviewLayout
              ? "2xl:col-start-2 2xl:row-span-2 2xl:row-start-1"
              : "lg:col-start-2 lg:row-span-2 lg:row-start-1"
          )}
        >
          <div className={cn("space-y-4", !isReviewLayout && "lg:sticky lg:top-32")}>
            {summary}
            <PosterTrustCard
              area={area}
              roleLabel={isTourism ? "Hosted by" : "Represented by"}
              name={ownerProfile?.display_name}
              trustLevel={isReviewLayout ? null : trustLevel}
            >
              {contactBlock}
            </PosterTrustCard>
            <SafetyTipsCard area={area} className={isReviewLayout ? "hidden" : "hidden lg:block"} />
          </div>
        </aside>

        <div
          className={cn(
            "min-w-0 space-y-6",
            isReviewLayout ? "2xl:col-start-1 2xl:row-start-2" : "lg:col-start-1 lg:row-start-2"
          )}
        >
          {business.description ? (
            <DetailSection title={`About ${business.business_name}`}>
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground/85">
                {business.description}
              </p>
            </DetailSection>
          ) : null}

          {keyFacts.length > 0 ? (
            <DetailSection title={isTourism ? "Good to know" : "Business facts"}>
              <FactGrid facts={keyFacts} />
            </DetailSection>
          ) : null}

          {isTourism ? (
            <TourismDetailsCard details={tourismDetails as TourismCategoryDetails} />
          ) : null}

          {categoryDetailFacts.length > 0 ? (
            <DetailSection title="More details">
              <FactGrid facts={categoryDetailFacts} />
            </DetailSection>
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

          {otherContacts}

          {!isReviewLayout ? <SafetyTipsCard area={area} className="lg:hidden" /> : null}

          {showPromotions && promotions.length > 0 ? (
            <section className="space-y-4">
              <h2 className="font-display text-xl font-semibold tracking-tight">
                Tourism & Events posts
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                    ownerTrustLevel={trustLevel ?? 0}
                    focalX={promo.focal_x}
                    focalY={promo.focal_y}
                    mediaWidth={promo.media_width}
                    mediaHeight={promo.media_height}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {showStickyContactBar ? (
        <StickyContactBar
          business={business}
          ctaLabel={isTourism ? "Call host" : "Call business"}
        />
      ) : null}
    </>
  );
}

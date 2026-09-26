"use client";

import { VideoViewTracker } from "@/components/ui/video-view-tracker";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { contactPhone, whatsappLink } from "@/lib/utils/contact-links";
import Image from "next/image";
import {
  Building2,
  CalendarClock,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Eye,
  MapPin,
  Maximize2,
  MessageCircle,
  Phone,
  Play,
  Ticket,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PromotionContactActions } from "@/components/listings/promotion-contact-actions";
import {
  DetailSection,
  FactGrid,
  PosterTrustCard,
  SafetyTipsCard,
  type DetailFact,
} from "@/components/listings/detail-panels";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { StickyMobileBar } from "@/components/ui/sticky-mobile-bar";
import {
  formatRandAmount,
  formatSaLongDate,
  formatSaShortDate,
  formatZARShort,
} from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { cn } from "@/lib/utils";
import { safeExternalHref } from "@/lib/utils/sanitize-html";
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";
import { type BusinessCategory, type AccountVerificationStatus } from "@/types/enums";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import { EVENT_AGE_RESTRICTIONS, EVENT_TYPES } from "@/lib/constants/categories";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { readAccountVerificationStatus } from "@/lib/account/compat";
import { ProfileVideoPlayer } from "@/components/ui/profile-video-player";
import type { EventDetails, TicketTier } from "@/types/tourism-details";
import { useHorizontalSwipeNavigation } from "@/hooks/use-horizontal-swipe-navigation";
import { useTrackContentView } from "@/hooks/use-track-content-view";
import { useHydrated } from "@/hooks/use-hydrated";

export interface PromotionDetailRecord {
  id: string;
  owner_id: string;
  business_id: string | null;
  title: string;
  description: string;
  promotion_type: string;
  category: string | null;
  category_key: BusinessCategory | null;
  photos: string[] | null;
  videos: string[] | null;
  video_thumbnail: string | null;
  price_cents: number | null;
  price_negotiable: boolean;
  location_province: string;
  location_city: string;
  location_town: string | null;
  location_address: string | null;
  contact_methods: string[] | null;
  start_date: string | null;
  end_date: string | null;
  boost_until: string | null;
  featured_until: string | null;
  view_count: number | null;
  created_at: string;
  logo_url?: string | null;
  event_details?: EventDetails | null;
  media_width?: number | null;
  media_height?: number | null;
}

export interface PromotionAdvertiserRecord {
  display_name: string | null;
  account_verification_status?: AccountVerificationStatus | null;
  phone: string | null;
  masked_phone_public: string | null;
}

export interface LinkedBusinessRecord {
  id: string;
  business_name: string;
  logo_url: string | null;
}

type PromotionMediaItem = {
  kind: "video" | "photo";
  url: string;
  poster?: string;
  photoNumber?: number;
};

type EventState = "upcoming" | "ongoing" | "ended";

function getEventState(
  startDate: string | null,
  endDate: string | null,
  nowMs: number
): EventState {
  const startsAt = startDate ? new Date(startDate).getTime() : null;
  const endsAt = endDate ? new Date(endDate).getTime() : null;

  if (startsAt != null && startsAt > nowMs) return "upcoming";
  if (endsAt != null && endsAt < nowMs) return "ended";
  return "ongoing";
}

const EVENT_STATE_BADGE: Record<EventState, { label: string; className: string }> = {
  upcoming: {
    label: "Upcoming",
    className: "bg-sunset-600 text-white",
  },
  ongoing: {
    label: "Happening now",
    className: "bg-brand-green-600 text-white",
  },
  ended: {
    label: "Event ended",
    className: "bg-warm-700 text-white",
  },
};

const CONTACT_METHOD_LABELS: Record<string, string> = {
  call: "Phone call",
  whatsapp: "WhatsApp",
  form: "Enquiry form",
  in_app: "Enquiry form",
};

const EVENT_RECURRING_LABELS: Record<string, string> = {
  one_off: "Once-off",
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Annual",
};

const EVENT_RAIN_POLICY_LABELS: Record<string, string> = {
  outdoor_rain_or_shine: "Outdoor, rain or shine",
  moved_indoors: "Moves indoors",
  postponed: "Postponed",
  refunded: "Refunded",
};

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/** Deterministic "18:00" in South African time (safe for hydration). */
function formatSaTime(date: string): string | null {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const sast = new Date(d.getTime() + SAST_OFFSET_MS);
  const hours = sast.getUTCHours();
  const minutes = sast.getUTCMinutes();
  if (hours === 0 && minutes === 0) return null; // date-only value
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatEventMoment(date: string) {
  const day = formatSaShortDate(date);
  const time = formatSaTime(date);
  return time ? `${day}, ${time}` : day;
}

function formatEventWhen(start: string | null, end: string | null) {
  if (!start) return end ? `Until ${formatEventMoment(end)}` : null;
  if (!end) return formatEventMoment(start);
  const sameDay = formatSaShortDate(start) === formatSaShortDate(end);
  const endTime = formatSaTime(end);
  if (sameDay)
    return endTime ? `${formatEventMoment(start)} – ${endTime}` : formatEventMoment(start);
  return `${formatEventMoment(start)} – ${formatEventMoment(end)}`;
}

function humanizeKey(value: string) {
  const text = value.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Early-bird deadlines are free text; show a real date consistently when we can parse one. */
function formatLooseDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? formatSaLongDate(value) || value : value;
}

/* ─── Countdown (isolated so the 1s tick doesn't re-render the whole page) ─── */
function EventCountdown({ targetDate, label }: { targetDate: string | null; label: string }) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);

  useEffect(() => {
    if (!targetDate) return;

    function compute() {
      const diff = new Date(targetDate!).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft(null);
        return;
      }
      setTimeLeft({
        days: Math.floor(diff / 86_400_000),
        hours: Math.floor((diff % 86_400_000) / 3_600_000),
        minutes: Math.floor((diff % 3_600_000) / 60_000),
        seconds: Math.floor((diff % 60_000) / 1000),
      });
    }

    compute();
    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  if (!timeLeft) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl bg-sunset-50 px-3.5 py-2.5 text-sunset-900 dark:bg-sunset-500/10 dark:text-sunset-200">
      <Timer className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="text-sm font-medium">{label}</p>
      <p className="ml-auto font-display text-base font-bold tabular-nums" aria-live="off">
        {timeLeft.days > 0 ? `${timeLeft.days}d ` : ""}
        {String(timeLeft.hours).padStart(2, "0")}h {String(timeLeft.minutes).padStart(2, "0")}m{" "}
        <span className="sr-only">and </span>
        {String(timeLeft.seconds).padStart(2, "0")}s
      </p>
    </div>
  );
}

const PUBLIC_GRID =
  "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_24rem]";
const REVIEW_GRID =
  "grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-rows-[auto_1fr] 2xl:gap-x-8";

export function PromotionDetailContent({
  promotion,
  advertiserProfile,
  linkedBusiness,
  showContactActions = true,
  showContactSummary = false,
  trackView = true,
  layoutMode = "public",
}: {
  promotion: PromotionDetailRecord;
  advertiserProfile: PromotionAdvertiserRecord | null;
  linkedBusiness: LinkedBusinessRecord | null;
  showContactActions?: boolean;
  showContactSummary?: boolean;
  trackView?: boolean;
  layoutMode?: "public" | "review";
}) {
  const isReviewLayout = layoutMode === "review";
  const shouldTrackView = trackView && !isReviewLayout;
  const [viewCount, setViewCount] = useState(promotion.view_count ?? 0);
  const handleViewRecorded = useCallback(() => {
    setViewCount((currentCount) => currentCount + 1);
  }, []);
  useTrackContentView(promotion.id, "promotion", shouldTrackView, handleViewRecorded);
  // The event state depends on "now": resolve it after mount so server and
  // browser render the same markup (no hydration mismatch at start/end times).
  const isHydrated = useHydrated();
  // eslint-disable-next-line react-hooks/purity -- read the clock only after hydration
  const nowMs = isHydrated ? Date.now() : null;
  const photos = promotion.photos ?? [];
  const videos = promotion.videos ?? [];
  const leadVideo = videos[0] ?? null;
  const leadPhoto = photos[0] ?? null;
  const leadPoster = promotion.video_thumbnail || leadPhoto || undefined;
  const mediaItems: PromotionMediaItem[] = leadVideo
    ? [
        { kind: "video", url: leadVideo, poster: leadPoster },
        ...videos.slice(1).map((url) => ({
          kind: "video" as const,
          url,
          poster: leadPoster,
        })),
        ...photos.map((url, index) => ({
          kind: "photo" as const,
          url,
          photoNumber: index + 1,
        })),
      ]
    : leadPhoto
      ? [
          { kind: "photo", url: leadPhoto, photoNumber: 1 },
          ...videos.map((url) => ({
            kind: "video" as const,
            url,
            poster: leadPoster,
          })),
          ...photos.slice(1).map((url, index) => ({
            kind: "photo" as const,
            url,
            photoNumber: index + 2,
          })),
        ]
      : videos.map((url) => ({
          kind: "video" as const,
          url,
          poster: leadPoster,
        }));
  const videoRef = useRef<HTMLVideoElement>(null);
  const manager = useVideoPlaybackManager();
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const activeMedia = mediaItems[activeMediaIndex] ?? null;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStart, setLightboxStart] = useState(0);
  const wasPlayingRef = useRef(false);
  const canPrevious = activeMediaIndex > 0;
  const canNext = activeMediaIndex < mediaItems.length - 1;

  function goTo(index: number) {
    if (index >= 0 && index < mediaItems.length) {
      setActiveMediaIndex(index);
    }
  }

  const swipeHandlers = useHorizontalSwipeNavigation({
    canPrevious,
    canNext,
    onPrevious: () => goTo(activeMediaIndex - 1),
    onNext: () => goTo(activeMediaIndex + 1),
  });

  const openLightbox = (idx: number) => {
    const v = videoRef.current;
    wasPlayingRef.current = v ? !v.paused : false;
    setLightboxStart(idx);
    setLightboxOpen(true);
    v?.pause();
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    if (videoRef.current && wasPlayingRef.current) {
      videoRef.current.play().catch(() => {});
    }
  };

  // Register hero video with global playback manager so it participates in
  // single-video arbitration (pauses when a card video claims priority).
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    manager.register(el);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          manager.updateVisibility(el, entry.intersectionRatio);
        } else {
          el.pause();
          manager.updateVisibility(el, 0);
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      manager.unregister(el);
    };
  }, [manager, activeMediaIndex]);
  const contactMethods = promotion.contact_methods ?? [];
  const canCall =
    showContactActions &&
    contactMethods.includes("call") &&
    Boolean(contactPhone(advertiserProfile?.phone));
  const canWhatsapp =
    showContactActions &&
    contactMethods.includes("whatsapp") &&
    Boolean(contactPhone(advertiserProfile?.phone));
  const showStickyBar = layoutMode === "public" && (canCall || canWhatsapp);
  const eventState =
    nowMs == null ? null : getEventState(promotion.start_date, promotion.end_date, nowMs);
  const rawCategoryLabel = getPromotionCategoryDisplayLabel(
    promotion.category_key,
    promotion.category
  );
  // Legacy rows can carry a bare key ("events", "food_market"); never show those raw.
  const categoryLabel =
    rawCategoryLabel && /^[a-z0-9_]+$/.test(rawCategoryLabel)
      ? humanizeKey(rawCategoryLabel)
      : rawCategoryLabel;
  const trustLevel =
    advertiserProfile && !isReviewLayout
      ? computeTrustLevel(readAccountVerificationStatus(advertiserProfile))
      : null;

  // Countdown to event start (upcoming) or end (ongoing)
  const countdownTarget =
    eventState === "upcoming"
      ? promotion.start_date
      : eventState === "ongoing"
        ? promotion.end_date
        : null;
  const ed = promotion.event_details ?? null;
  const eventTypeLabel = ed?.event_type
    ? (EVENT_TYPES.find((t) => t.value === ed.event_type)?.label ?? humanizeKey(ed.event_type))
    : null;
  const ageLabel = ed?.age_restriction
    ? (EVENT_AGE_RESTRICTIONS.find((a) => a.value === ed.age_restriction)?.label ??
      humanizeKey(ed.age_restriction))
    : null;
  const ticketTiers = ed?.ticket_tiers ?? [];
  const paidTierPrices = ticketTiers
    .map((tier) => tier.price_cents)
    .filter((price): price is number => typeof price === "number" && price > 0);
  const allTiersFree = ticketTiers.length > 0 && paidTierPrices.length === 0;
  const priceLabel =
    promotion.price_cents != null && promotion.price_cents > 0
      ? formatZARShort(promotion.price_cents)
      : paidTierPrices.length > 0
        ? `From ${formatZARShort(Math.min(...paidTierPrices))}`
        : allTiersFree
          ? "Free entry"
          : null;
  const whenLabel = formatEventWhen(promotion.start_date, promotion.end_date);
  const locationLabel = [
    promotion.location_town,
    promotion.location_city,
    promotion.location_province,
  ]
    .filter(Boolean)
    .join(", ");
  const TitleTag = isReviewLayout ? "h2" : "h1";

  const eventFacts: DetailFact[] = [
    ...(eventTypeLabel ? [{ label: "Event type", value: eventTypeLabel }] : []),
    ...(categoryLabel ? [{ label: "Category", value: categoryLabel }] : []),
    ...(promotion.start_date
      ? [{ label: "Starts", value: formatEventMoment(promotion.start_date) }]
      : []),
    ...(promotion.end_date
      ? [{ label: "Ends", value: formatEventMoment(promotion.end_date) }]
      : []),
    ...(typeof ed?.venue_capacity === "number"
      ? [{ label: "Capacity", value: `${formatRandAmount(ed.venue_capacity)} people` }]
      : []),
    ...(ageLabel ? [{ label: "Age", value: ageLabel }] : []),
    ...(ed?.dress_code ? [{ label: "Dress code", value: ed.dress_code }] : []),
    ...(ed?.parking_available != null
      ? [{ label: "Parking", value: ed.parking_available ? "Available" : "Not available" }]
      : []),
    ...(ed?.food_drinks_available != null
      ? [
          {
            label: "Food and drinks",
            value: ed.food_drinks_available ? "Available" : "Not available",
          },
        ]
      : []),
    ...(ed?.recurring
      ? [
          {
            label: "Repeats",
            value: EVENT_RECURRING_LABELS[ed.recurring] ?? humanizeKey(ed.recurring),
          },
        ]
      : []),
    ...(ed?.rain_policy
      ? [
          {
            label: "If it rains",
            value: EVENT_RAIN_POLICY_LABELS[ed.rain_policy] ?? humanizeKey(ed.rain_policy),
          },
        ]
      : []),
    ...(ed?.early_bird_deadline
      ? [{ label: "Early-bird until", value: formatLooseDate(ed.early_bird_deadline) }]
      : []),
    ...(ed?.group_discount_available != null
      ? [
          {
            label: "Group discounts",
            value: ed.group_discount_available ? "Available" : "Not available",
          },
        ]
      : []),
    ...(ed?.bring_your_own
      ? [{ label: "What to bring", value: ed.bring_your_own, wide: true }]
      : []),
  ];

  // Calendar link (Google Calendar)
  const calendarUrl = promotion.start_date
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(promotion.title)}&dates=${promotion.start_date.replace(/[-:]/g, "").split(".")[0]}Z${promotion.end_date ? `/${promotion.end_date.replace(/[-:]/g, "").split(".")[0]}Z` : ""}&details=${encodeURIComponent(promotion.description?.slice(0, 500) ?? "")}&location=${encodeURIComponent([promotion.location_town, promotion.location_city, promotion.location_province].filter(Boolean).join(", "))}`
    : null;

  const logoUrl = promotion.logo_url ?? linkedBusiness?.logo_url ?? null;

  const summary = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {eventState ? (
          <Badge className={`${EVENT_STATE_BADGE[eventState].className} border-0`}>
            {EVENT_STATE_BADGE[eventState].label}
          </Badge>
        ) : null}
        {eventTypeLabel || categoryLabel ? (
          <Badge variant="secondary" className="text-xs">
            {eventTypeLabel ?? categoryLabel}
          </Badge>
        ) : null}
      </div>

      <TitleTag className="font-display text-[1.6rem] font-bold leading-[1.15] tracking-tight text-foreground sm:text-[2rem]">
        {promotion.title}
      </TitleTag>

      {priceLabel ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="font-display text-[2rem] font-extrabold leading-none tracking-tight text-foreground">
            {priceLabel}
          </p>
          {promotion.price_negotiable ? <Badge variant="verified">Negotiable</Badge> : null}
        </div>
      ) : null}

      <ul className="space-y-2 text-sm">
        {whenLabel ? (
          <li className="flex items-start gap-2.5">
            <CalendarClock
              className="mt-0.5 h-4 w-4 shrink-0 text-sunset-700 dark:text-sunset-300"
              aria-hidden="true"
            />
            <span className="font-medium text-foreground">
              {promotion.start_date ? (
                <time dateTime={promotion.start_date}>{whenLabel}</time>
              ) : (
                whenLabel
              )}
            </span>
          </li>
        ) : null}
        {ed?.venue_name || locationLabel ? (
          <li className="flex items-start gap-2.5">
            <MapPin
              className="mt-0.5 h-4 w-4 shrink-0 text-sunset-700 dark:text-sunset-300"
              aria-hidden="true"
            />
            <span className="text-muted-foreground">
              {ed?.venue_name ? (
                <span className="block font-medium text-foreground">{ed.venue_name}</span>
              ) : null}
              {locationLabel}
              {promotion.location_address ? (
                <span className="block">{promotion.location_address}</span>
              ) : null}
            </span>
          </li>
        ) : null}
        <li className="flex items-center gap-2.5 text-muted-foreground">
          <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {viewCount} {viewCount === 1 ? "view" : "views"}
          </span>
        </li>
      </ul>

      <EventCountdown
        targetDate={countdownTarget}
        label={eventState === "upcoming" ? "Starts in" : "Ends in"}
      />

      {calendarUrl || ed?.tickets_url ? (
        <div className="flex flex-wrap gap-2">
          {ed?.tickets_url ? (
            <Button asChild className="gap-2 bg-sunset-600 text-white hover:bg-sunset-700">
              <a
                href={safeExternalHref(ed.tickets_url)}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
              >
                <Ticket className="h-4 w-4" aria-hidden="true" />
                Buy tickets
              </a>
            </Button>
          ) : null}
          {calendarUrl && eventState !== "ended" ? (
            <Button asChild variant="outline" className="gap-2">
              <a href={calendarUrl} target="_blank" rel="noopener noreferrer">
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                Add to calendar
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const contactBlock = showContactActions ? (
    <PromotionContactActions
      promotionId={promotion.id}
      contactMethods={contactMethods}
      advertiserPhone={contactMethods.includes("call") ? (advertiserProfile?.phone ?? null) : null}
      advertiserWhatsapp={
        contactMethods.includes("whatsapp") ? (advertiserProfile?.phone ?? null) : null
      }
    />
  ) : (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Your preview — only you can see this</p>
      <p>Contact buttons appear once approved.</p>
    </div>
  );

  const linkedBusinessCard = linkedBusiness ? (
    <Link
      href={`/mzansi-business/${linkedBusiness.id}`}
      className="surface-card elev-xs flex items-center gap-3 rounded-2xl p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1 ring-1 ring-border dark:bg-warm-900">
        {linkedBusiness.logo_url ? (
          <Image
            src={normalizeMediaUrl(linkedBusiness.logo_url)}
            alt=""
            width={40}
            height={40}
            className="h-full w-full object-contain"
          />
        ) : (
          <Building2
            className="h-5 w-5 text-brand-blue-700 dark:text-brand-blue-300"
            aria-hidden="true"
          />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">Organised by</span>
        <span className="block break-words text-sm font-semibold text-foreground">
          {linkedBusiness.business_name}
        </span>
      </span>
      <span className="ml-auto text-sm font-medium text-brand-blue-700 dark:text-brand-blue-300">
        View business
      </span>
    </Link>
  ) : null;

  return (
    <article
      data-layout-mode={layoutMode}
      className={cn(isReviewLayout ? REVIEW_GRID : PUBLIC_GRID, showStickyBar && "pb-24 lg:pb-0")}
    >
      <div
        className={cn(
          "min-w-0 space-y-3",
          isReviewLayout ? "2xl:col-start-1 2xl:row-start-1" : "lg:col-start-1 lg:row-start-1"
        )}
      >
        {activeMedia ? (
          <div
            className="relative overflow-hidden rounded-3xl bg-warm-950 elev-sm"
            {...swipeHandlers}
          >
            <div className="relative aspect-[4/5] touch-pan-y overflow-hidden sm:aspect-[4/3]">
              {activeMedia.kind === "video" ? (
                <VideoViewTracker
                  targetId={promotion.id}
                  targetType="promotion"
                  enabled={shouldTrackView}
                  onRecorded={handleViewRecorded}
                >
                  <ProfileVideoPlayer
                    ref={videoRef}
                    src={normalizeMediaUrl(activeMedia.url)}
                    poster={activeMedia.poster ? normalizeMediaUrl(activeMedia.poster) : undefined}
                    prioritizePoster={activeMediaIndex === 0}
                    autoPlayOnMobile={false}
                    title={promotion.title}
                    mediaFit="contain"
                    videoClassName="bg-black object-contain"
                    skipSeconds={10}
                    showErrorState
                  />
                </VideoViewTracker>
              ) : (
                <button
                  type="button"
                  className="group relative h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                  onClick={() => openLightbox(activeMediaIndex)}
                  aria-label={`View ${promotion.title} photo fullscreen`}
                >
                  <Image
                    src={normalizeMediaUrl(activeMedia.url)}
                    alt=""
                    aria-hidden="true"
                    fill
                    className="hidden scale-110 object-fill opacity-60 md:block md:blur-2xl md:motion-reduce:blur-none"
                    sizes="(max-width: 1024px) 100vw, 66vw"
                  />
                  <Image
                    src={normalizeMediaUrl(activeMedia.url)}
                    alt={promotion.title}
                    fill
                    className="object-contain"
                    sizes="(max-width: 1024px) 100vw, 66vw"
                    priority
                  />
                  <span className="absolute bottom-3 right-3 z-10 rounded-full bg-black/55 p-2 text-white transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                    <Maximize2 className="h-4 w-4" aria-hidden="true" />
                  </span>
                </button>
              )}

              {logoUrl ? (
                <div className="pointer-events-none absolute bottom-3 left-3 h-12 w-12 overflow-hidden rounded-xl border border-white/20 bg-white p-1 shadow-md">
                  <Image
                    src={normalizeMediaUrl(logoUrl)}
                    alt={`${promotion.title} logo`}
                    width={48}
                    height={48}
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : null}

              {mediaItems.length > 1 ? (
                <>
                  <span className="absolute left-3 top-3 z-20 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold tabular-nums text-white">
                    {activeMediaIndex + 1} / {mediaItems.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => goTo(activeMediaIndex - 1)}
                    disabled={!canPrevious}
                    className="absolute left-3 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none disabled:opacity-0"
                    aria-label="Previous media"
                    data-carousel-control="true"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goTo(activeMediaIndex + 1)}
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
        ) : (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-3xl bg-gradient-to-br from-sunset-600 to-warm-950 text-white/75">
            <CalendarClock className="h-10 w-10" aria-hidden="true" />
            <p className="text-sm">No photos added yet</p>
          </div>
        )}

        {mediaItems.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {mediaItems.map((item, index) => {
              const isVideo = item.kind === "video";
              const isActive = index === activeMediaIndex;
              return (
                <button
                  key={`${item.kind}-${index}`}
                  type="button"
                  onClick={() => goTo(index)}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 bg-warm-950 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-20 sm:w-20",
                    isActive
                      ? "border-sunset-600 shadow-md"
                      : "border-transparent opacity-70 hover:opacity-100"
                  )}
                  aria-label={
                    isVideo
                      ? `View video ${index + 1}`
                      : `View photo ${item.photoNumber ?? index + 1}`
                  }
                  data-carousel-control="true"
                >
                  {isVideo ? (
                    <>
                      {item.poster ? (
                        <Image
                          src={normalizeMediaUrl(item.poster)}
                          alt={`${promotion.title} video thumbnail`}
                          fill
                          className="object-contain"
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
                      src={normalizeMediaUrl(item.url)}
                      alt={`${promotion.title} photo ${item.photoNumber ?? index + 1}`}
                      fill
                      className="object-contain"
                      sizes="80px"
                    />
                  )}
                </button>
              );
            })}
          </div>
        ) : null}
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
            area="tourism"
            roleLabel="Hosted by"
            name={advertiserProfile?.display_name}
            trustLevel={trustLevel}
          >
            {contactBlock}
          </PosterTrustCard>
          {linkedBusinessCard}
          <SafetyTipsCard
            area="tourism"
            className={isReviewLayout ? "hidden" : "hidden lg:block"}
          />
        </div>
      </aside>

      <div
        className={cn(
          "min-w-0 space-y-6",
          isReviewLayout ? "2xl:col-start-1 2xl:row-start-2" : "lg:col-start-1 lg:row-start-2"
        )}
      >
        {promotion.description ? (
          <DetailSection title="About this event">
            <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground/85">
              {promotion.description}
            </p>
          </DetailSection>
        ) : null}

        {eventFacts.length > 0 ||
        ed?.lineup ||
        ticketTiers.length > 0 ||
        ed?.accessibility?.length ? (
          <DetailSection title="Event details">
            <div className="space-y-5">
              <FactGrid facts={eventFacts} />

              {ticketTiers.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Ticket
                      className="h-4 w-4 text-sunset-700 dark:text-sunset-300"
                      aria-hidden="true"
                    />
                    Tickets
                  </h3>
                  <ul className="divide-y divide-border/70 rounded-xl border border-border/70">
                    {ticketTiers.map((tier: TicketTier, i: number) => (
                      <li
                        key={`${tier.name}-${i}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-sm"
                      >
                        <span className="font-medium">{tier.name}</span>
                        <span className="font-semibold">
                          {tier.price_cents != null && tier.price_cents > 0
                            ? formatZARShort(tier.price_cents)
                            : "Free"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {ed?.lineup ? (
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Line-up</h3>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{ed.lineup}</p>
                </div>
              ) : null}

              {ed?.accessibility && ed.accessibility.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Accessibility</h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {ed.accessibility.map((a) => (
                      <li key={a} className="chip">
                        {humanizeKey(a)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </DetailSection>
        ) : null}

        {showContactSummary && contactMethods.length > 0 ? (
          <DetailSection title="Saved contact methods" headingLevel="h2">
            <ul className="flex flex-wrap gap-1.5">
              {contactMethods.map((method) => (
                <li key={method} className="chip">
                  {CONTACT_METHOD_LABELS[method] ?? humanizeKey(method)}
                </li>
              ))}
            </ul>
          </DetailSection>
        ) : null}

        {!isReviewLayout ? <SafetyTipsCard area="tourism" className="lg:hidden" /> : null}

        <p className="text-xs text-muted-foreground">
          Posted{" "}
          <time dateTime={promotion.created_at}>{formatSaLongDate(promotion.created_at)}</time>
        </p>
      </div>

      {/* ═══ MEDIA LIGHTBOX ═══ */}
      <MediaLightbox
        items={mediaItems.map((m) => ({
          url: m.url,
          kind: m.kind,
          poster: m.kind === "video" ? (m.poster ?? undefined) : undefined,
        }))}
        startIndex={lightboxStart}
        isOpen={lightboxOpen}
        onClose={closeLightbox}
      />

      {showStickyBar && (
        <StickyMobileBar>
          {canCall && (
            <Button
              type="button"
              className="h-12 flex-1 gap-2 rounded-full font-semibold"
              size="lg"
              asChild
            >
              <a href={`tel:${contactPhone(advertiserProfile?.phone)}`}>
                <Phone className="h-4 w-4" aria-hidden="true" /> Call host
              </a>
            </Button>
          )}

          {canWhatsapp && advertiserProfile?.phone && (
            <Button
              variant="outline"
              className="h-12 flex-1 gap-2 rounded-full border-brand-green/30 font-semibold"
              size="lg"
              asChild
            >
              <a
                href={whatsappLink(
                  advertiserProfile.phone,
                  promotion.title,
                  `/tourism-events/${promotion.id}`
                )!}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
              >
                <MessageCircle className="h-4 w-4 text-brand-green-600" aria-hidden="true" />
                WhatsApp
              </a>
            </Button>
          )}
        </StickyMobileBar>
      )}
    </article>
  );
}

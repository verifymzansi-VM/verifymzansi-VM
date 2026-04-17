"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Building2,
  Calendar,
  CalendarPlus,
  ChevronDown,
  Eye,
  Globe,
  MapPin,
  Maximize2,
  MessageCircle,
  Music2,
  Phone,
  Play,
  Ticket,
  Timer,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PromotionContactActions } from "@/app/promotion/[id]/promotion-contact-actions";
import { TrustBadge } from "@/components/trust/trust-badge";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { formatZAR } from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { cn } from "@/lib/utils";
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

function getEventState(startDate: string | null, endDate: string | null) {
  const now = new Date();
  const startsAt = startDate ? new Date(startDate) : null;
  const endsAt = endDate ? new Date(endDate) : null;

  if (startsAt && startsAt > now) return "upcoming";
  if (endsAt && endsAt < now) return "ended";
  return "ongoing";
}

const EVENT_STATE_BADGE: Record<string, { label: string; className: string }> = {
  upcoming: {
    label: "Upcoming Event",
    className: "bg-brand-blue text-white",
  },
  ongoing: {
    label: "Happening Now",
    className: "bg-brand-green text-white",
  },
  ended: {
    label: "Event Ended",
    className: "bg-muted text-foreground",
  },
};

const CONTACT_METHOD_LABELS: Record<string, string> = {
  call: "Phone Call",
  whatsapp: "WhatsApp",
  form: "Contact Form",
};

/* ─── Countdown timer hook ─── */
function useCountdown(targetDate: string | null) {
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

  return timeLeft;
}

export function PromotionDetailContent({
  promotion,
  advertiserProfile,
  linkedBusiness,
  showContactActions = true,
  showContactSummary = false,
}: {
  promotion: PromotionDetailRecord;
  advertiserProfile: PromotionAdvertiserRecord | null;
  linkedBusiness: LinkedBusinessRecord | null;
  showContactActions?: boolean;
  showContactSummary?: boolean;
}) {
  useTrackContentView(promotion.id, "promotion");
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
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [showStickyContact, setShowStickyContact] = useState(false);
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
    Boolean(advertiserProfile?.masked_phone_public);
  const canWhatsapp =
    showContactActions && contactMethods.includes("whatsapp") && Boolean(advertiserProfile?.phone);
  const showStickyBar = canCall || canWhatsapp;
  const eventState = getEventState(promotion.start_date, promotion.end_date);
  const categoryLabel = getPromotionCategoryDisplayLabel(
    promotion.category_key,
    promotion.category
  );
  const trustLevel = advertiserProfile
    ? computeTrustLevel(readAccountVerificationStatus(advertiserProfile))
    : 0;

  // Countdown to event start (upcoming) or end (ongoing)
  const countdownTarget =
    eventState === "upcoming"
      ? promotion.start_date
      : eventState === "ongoing"
        ? promotion.end_date
        : null;
  const countdown = useCountdown(countdownTarget);
  const heroUsesContain =
    typeof promotion.media_width === "number" &&
    typeof promotion.media_height === "number" &&
    promotion.media_width > promotion.media_height * 1.2;
  const eventTypeLabel = promotion.event_details?.event_type
    ? EVENT_TYPES.find((t) => t.value === promotion.event_details?.event_type)?.label
    : null;
  const venueLabel = promotion.event_details?.venue_name ?? null;
  const ticketSummary =
    promotion.event_details?.ticket_tiers && promotion.event_details.ticket_tiers.length > 0
      ? `${promotion.event_details.ticket_tiers.length} ticket tier${
          promotion.event_details.ticket_tiers.length === 1 ? "" : "s"
        }`
      : promotion.event_details?.tickets_url
        ? "Tickets available"
        : null;

  // Calendar link (Google Calendar)
  const calendarUrl = promotion.start_date
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(promotion.title)}&dates=${promotion.start_date.replace(/[-:]/g, "").split(".")[0]}Z${promotion.end_date ? `/${promotion.end_date.replace(/[-:]/g, "").split(".")[0]}Z` : ""}&details=${encodeURIComponent(promotion.description?.slice(0, 500) ?? "")}&location=${encodeURIComponent([promotion.location_town, promotion.location_city, promotion.location_province].filter(Boolean).join(", "))}`
    : null;

  return (
    <article
      className={
        showStickyBar
          ? "grid grid-cols-1 gap-4 pb-24 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(18rem,20rem)] lg:gap-6 lg:pb-0"
          : "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(18rem,20rem)] lg:gap-6"
      }
    >
      {activeMedia ? (
        <div className="space-y-4 lg:w-[20rem]">
          <div
            className="mx-auto w-full max-w-[280px] overflow-hidden rounded-[28px] border border-slate-200/70 bg-black shadow-[0_35px_80px_-48px_rgba(15,23,42,0.55)] sm:max-w-[320px] lg:max-w-none"
            {...swipeHandlers}
          >
            <div className={cn("relative aspect-[9/16] overflow-hidden bg-black touch-pan-y")}>
              {activeMedia.kind === "video" ? (
                <ProfileVideoPlayer
                  ref={videoRef}
                  src={normalizeMediaUrl(activeMedia.url)}
                  poster={activeMedia.poster ? normalizeMediaUrl(activeMedia.poster) : undefined}
                  title={promotion.title}
                  videoClassName={heroUsesContain ? "object-contain" : "object-cover"}
                  skipSeconds={10}
                  showErrorState
                />
              ) : (
                <button
                  type="button"
                  className="relative h-full w-full cursor-zoom-in"
                  onClick={() => openLightbox(activeMediaIndex)}
                  aria-label={`View ${promotion.title} photo fullscreen`}
                >
                  <Image
                    src={normalizeMediaUrl(activeMedia.url)}
                    alt={promotion.title}
                    fill
                    className={heroUsesContain ? "object-contain" : "object-cover"}
                    sizes="(max-width: 1024px) 78vw, 320px"
                    priority
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
                  <div className="absolute bottom-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm">
                    <Maximize2 className="h-5 w-5" />
                  </div>
                </button>
              )}

              <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                <Badge className="bg-black/50 text-white backdrop-blur-sm border-0">Event</Badge>
                {eventState && (
                  <Badge className={`${EVENT_STATE_BADGE[eventState].className} border-0`}>
                    {EVENT_STATE_BADGE[eventState].label}
                  </Badge>
                )}
              </div>

              {(promotion.logo_url || linkedBusiness?.logo_url) && (
                <div className="absolute bottom-4 left-4 h-12 w-12 overflow-hidden rounded-xl border border-white/20 bg-white shadow-md">
                  <Image
                    src={normalizeMediaUrl((promotion.logo_url ?? linkedBusiness?.logo_url)!)}
                    alt={`${promotion.title} logo`}
                    width={48}
                    height={48}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
            </div>
          </div>

          {mediaItems.length > 1 && (
            <div className="mx-auto flex w-full max-w-[320px] gap-2 overflow-x-auto pb-1 lg:max-w-none">
              {mediaItems.map((item, index) => {
                if (index === activeMediaIndex) return null;
                const isVideo = item.kind === "video";
                return (
                  <button
                    key={`${item.kind}-${index}`}
                    type="button"
                    onClick={() => goTo(index)}
                    className="group relative aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-2xl ring-2 ring-transparent transition-all hover:shadow-md hover:ring-brand-blue/50"
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
                            className="object-cover transition-transform group-hover:scale-105"
                            sizes="80px"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-black" />
                        )}
                        <div className="absolute inset-0 bg-black/25" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="rounded-full bg-white/90 p-2 shadow-lg backdrop-blur-sm">
                            <Play className="h-4 w-4 text-black fill-black" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <Image
                        src={normalizeMediaUrl(item.url)}
                        alt={`${promotion.title} photo ${item.photoNumber ?? index + 1}`}
                        fill
                        className="object-cover transition-transform group-hover:scale-105"
                        sizes="80px"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <div className={cn("space-y-4", !activeMedia && "lg:col-span-2")}>
        {/* ═══ TITLE BAR — fallback when no media hero ═══ */}
        {!activeMedia && (
          <div>
            <h1 className="font-display text-xl font-bold leading-tight sm:text-2xl">
              {promotion.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge className="bg-black/70 text-white backdrop-blur-sm border-0">Event</Badge>
              {eventState && (
                <Badge className={`${EVENT_STATE_BADGE[eventState].className} border-0`}>
                  {EVENT_STATE_BADGE[eventState].label}
                </Badge>
              )}
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {[promotion.location_town, promotion.location_city, promotion.location_province]
                  .filter(Boolean)
                  .join(", ")}
              </span>
              {promotion.price_cents != null && promotion.price_cents > 0 && (
                <span className="font-bold">
                  {formatZAR(promotion.price_cents)}
                  {promotion.price_negotiable && (
                    <span className="ml-1 text-xs font-normal text-brand-green">Negotiable</span>
                  )}
                </span>
              )}
            </div>
          </div>
        )}
        <div className="space-y-4">
          <Card className="border-slate-200/75 bg-white/95 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-slate-950/75">
            <CardContent className="space-y-4 p-5">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Event At A Glance
                </p>
                <h2 className="font-display text-xl font-semibold">
                  Date, venue, and ticket clarity first
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {promotion.start_date ? (
                  <div className="rounded-2xl border border-slate-200/70 bg-slate-50/90 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Starts
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {new Date(promotion.start_date).toLocaleDateString("en-ZA", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                ) : null}
                {venueLabel ? (
                  <div className="rounded-2xl border border-slate-200/70 bg-slate-50/90 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Venue
                    </p>
                    <p className="mt-1 text-sm font-medium">{venueLabel}</p>
                  </div>
                ) : null}
                {eventTypeLabel ? (
                  <div className="rounded-2xl border border-slate-200/70 bg-slate-50/90 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Event Type
                    </p>
                    <p className="mt-1 text-sm font-medium">{eventTypeLabel}</p>
                  </div>
                ) : null}
                {ticketSummary ? (
                  <div className="rounded-2xl border border-slate-200/70 bg-slate-50/90 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Tickets
                    </p>
                    <p className="mt-1 text-sm font-medium">{ticketSummary}</p>
                  </div>
                ) : null}
              </div>
              {(promotion.location_city || promotion.location_province) && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 text-brand-blue" />
                  <span>
                    {[promotion.location_town, promotion.location_city, promotion.location_province]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ═══ EVENT COUNTDOWN (compact) ═══ */}
          {countdown && (
            <div className="flex items-center justify-between rounded-xl border border-brand-blue/20 bg-gradient-to-r from-brand-blue/5 to-brand-blue/10 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-brand-blue">
                <Timer className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {eventState === "upcoming" ? "Starts in" : "Ends in"}
                </span>
              </div>
              <div className="flex gap-2 text-center">
                {[
                  { value: countdown.days, label: "D" },
                  { value: countdown.hours, label: "H" },
                  { value: countdown.minutes, label: "M" },
                  { value: countdown.seconds, label: "S" },
                ].map((unit) => (
                  <div key={unit.label} className="min-w-[2.5rem]">
                    <div className="font-display text-lg font-bold tabular-nums sm:text-xl">
                      {String(unit.value).padStart(2, "0")}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                      {unit.label}
                    </div>
                  </div>
                ))}
              </div>
              {calendarUrl && (
                <Button asChild variant="outline" size="sm" className="gap-1 text-xs">
                  <a href={calendarUrl} target="_blank" rel="noopener noreferrer">
                    <CalendarPlus className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Add to Calendar</span>
                    <span className="sm:hidden">Cal</span>
                  </a>
                </Button>
              )}
            </div>
          )}

          {/* ═══ CONTACT ACTIONS — mobile-first, above details ═══ */}
          {showContactActions && (
            <div className="lg:hidden">
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-bold text-white">
                    {advertiserProfile?.display_name?.charAt(0)?.toUpperCase() || "A"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {advertiserProfile?.display_name || "Advertiser"}
                    </p>
                    <TrustBadge level={trustLevel} size="sm" />
                  </div>
                </CardContent>
              </Card>
              <div className="mt-2">
                <PromotionContactActions
                  promotionId={promotion.id}
                  contactMethods={contactMethods}
                  advertiserPhone={
                    contactMethods.includes("call")
                      ? (advertiserProfile?.masked_phone_public ?? null)
                      : null
                  }
                  advertiserWhatsapp={
                    contactMethods.includes("whatsapp") ? (advertiserProfile?.phone ?? null) : null
                  }
                />
              </div>
            </div>
          )}

          {/* ═══ DESCRIPTION — condensed ═══ */}
          {promotion.description && (
            <div className="space-y-1">
              <p
                className={`whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground ${
                  !isDescExpanded ? "line-clamp-2" : ""
                }`}
              >
                {promotion.description}
              </p>
              {promotion.description.length > 100 && (
                <button
                  type="button"
                  onClick={() => setIsDescExpanded(!isDescExpanded)}
                  className="text-sm font-medium text-brand-blue hover:underline"
                >
                  {isDescExpanded ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          )}

          {/* ═══ DETAILS — collapsible single section ═══ */}
          <div className="rounded-xl border">
            <button
              type="button"
              onClick={() => setIsDetailsOpen(!isDetailsOpen)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
            >
              Details
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${
                  isDetailsOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {isDetailsOpen && (
              <div className="border-t px-4 py-3">
                <dl className="grid grid-cols-2 gap-y-2.5 text-sm">
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-medium">Event</dd>

                  {categoryLabel && (
                    <>
                      <dt className="text-muted-foreground">Category</dt>
                      <dd className="font-medium">{categoryLabel}</dd>
                    </>
                  )}

                  {promotion.start_date && (
                    <>
                      <dt className="text-muted-foreground">Starts</dt>
                      <dd className="flex items-center gap-1 font-medium">
                        <Calendar className="h-3 w-3" />
                        <time dateTime={promotion.start_date}>
                          {new Date(promotion.start_date).toLocaleDateString("en-ZA", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </time>
                      </dd>
                    </>
                  )}

                  {promotion.end_date && (
                    <>
                      <dt className="text-muted-foreground">Ends</dt>
                      <dd className="flex items-center gap-1 font-medium">
                        <Calendar className="h-3 w-3" />
                        <time dateTime={promotion.end_date}>
                          {new Date(promotion.end_date).toLocaleDateString("en-ZA", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </time>
                      </dd>
                    </>
                  )}

                  <dt className="text-muted-foreground">Views</dt>
                  <dd className="flex items-center gap-1 font-medium">
                    <Eye className="h-3 w-3" />
                    {promotion.view_count || 0}
                  </dd>
                </dl>

                {(showContactSummary || contactMethods.length > 0) && contactMethods.length > 0 && (
                  <div className="mt-3 border-t pt-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      {showContactSummary ? "Saved contact methods" : "Contact options"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {contactMethods.map((method) => (
                        <Badge key={method} variant="outline" className="capitalize text-xs">
                          {CONTACT_METHOD_LABELS[method] ?? method}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ═══ EVENT DETAILS — venue, tickets, accessibility ═══ */}
          {promotion.event_details &&
            (() => {
              const ed = promotion.event_details!;
              const eventTypeLabel = EVENT_TYPES.find((t) => t.value === ed.event_type)?.label;
              const ageLabel = EVENT_AGE_RESTRICTIONS.find(
                (a) => a.value === ed.age_restriction
              )?.label;
              const hasContent =
                ed.event_type ||
                ed.venue_name ||
                ed.venue_capacity ||
                (ed.ticket_tiers && ed.ticket_tiers.length > 0) ||
                ed.tickets_url ||
                ed.age_restriction ||
                ed.dress_code ||
                ed.lineup ||
                ed.parking_available != null ||
                ed.accessibility?.length ||
                ed.food_drinks_available != null ||
                ed.bring_your_own;
              if (!hasContent) return null;
              return (
                <Card>
                  <CardContent className="space-y-4 p-4 text-sm">
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Music2 className="h-4 w-4 text-muted-foreground" />
                      Event Details
                    </h3>

                    <dl className="grid grid-cols-2 gap-y-2.5">
                      {eventTypeLabel && (
                        <>
                          <dt className="text-muted-foreground">Event type</dt>
                          <dd>
                            <Badge variant="secondary">{eventTypeLabel}</Badge>
                          </dd>
                        </>
                      )}

                      {ed.venue_name && (
                        <>
                          <dt className="text-muted-foreground">Venue</dt>
                          <dd className="font-medium">{ed.venue_name}</dd>
                        </>
                      )}

                      {typeof ed.venue_capacity === "number" && (
                        <>
                          <dt className="flex items-center gap-1 text-muted-foreground">
                            <Users className="h-3 w-3" /> Capacity
                          </dt>
                          <dd className="font-medium">
                            {ed.venue_capacity.toLocaleString("en-ZA")}
                          </dd>
                        </>
                      )}

                      {ageLabel && (
                        <>
                          <dt className="text-muted-foreground">Age restriction</dt>
                          <dd className="font-medium">{ageLabel}</dd>
                        </>
                      )}

                      {ed.dress_code && (
                        <>
                          <dt className="text-muted-foreground">Dress code</dt>
                          <dd className="font-medium">{ed.dress_code}</dd>
                        </>
                      )}

                      {ed.parking_available != null && (
                        <>
                          <dt className="text-muted-foreground">Parking</dt>
                          <dd className="font-medium">
                            {ed.parking_available ? "Available" : "Not available"}
                          </dd>
                        </>
                      )}

                      {ed.food_drinks_available != null && (
                        <>
                          <dt className="flex items-center gap-1 text-muted-foreground">
                            <UtensilsCrossed className="h-3 w-3" /> Food &amp; drinks
                          </dt>
                          <dd className="font-medium">
                            {ed.food_drinks_available ? "Available" : "Not available"}
                          </dd>
                        </>
                      )}
                    </dl>

                    {ed.lineup && (
                      <div className="space-y-1">
                        <p className="text-muted-foreground">Lineup / Performers</p>
                        <p className="whitespace-pre-wrap font-medium">{ed.lineup}</p>
                      </div>
                    )}

                    {ed.ticket_tiers && ed.ticket_tiers.length > 0 && (
                      <div className="space-y-2">
                        <p className="flex items-center gap-1 text-muted-foreground">
                          <Ticket className="h-3 w-3" /> Tickets
                        </p>
                        <div className="divide-y rounded-lg border">
                          {ed.ticket_tiers.map((tier: TicketTier, i: number) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2">
                              <span className="font-medium">{tier.name}</span>
                              <span className="font-bold">
                                {tier.price_cents != null && tier.price_cents > 0
                                  ? `R${(tier.price_cents / 100).toFixed(0)}`
                                  : "Free"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {ed.tickets_url && (
                      <Button asChild variant="outline" className="w-full gap-2">
                        <a
                          href={ed.tickets_url}
                          target="_blank"
                          rel="noopener noreferrer nofollow ugc"
                        >
                          <Globe className="h-4 w-4" />
                          Buy Tickets
                        </a>
                      </Button>
                    )}

                    {ed.accessibility && ed.accessibility.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-muted-foreground">Accessibility</p>
                        <div className="flex flex-wrap gap-1.5">
                          {ed.accessibility.map((a) => (
                            <Badge key={a} variant="outline" className="text-xs">
                              {a}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {ed.bring_your_own && (
                      <div className="space-y-1">
                        <p className="text-muted-foreground">What to bring</p>
                        <p className="font-medium">{ed.bring_your_own}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
        </div>

        {/* ═══ LINKED BUSINESS + POSTED — mobile only ═══ */}
        <div className="space-y-3 lg:hidden">
          {linkedBusiness && (
            <Link
              href={`/mzansi-business/${linkedBusiness.id}`}
              className="flex items-center gap-3 rounded-xl border p-3 transition-opacity hover:opacity-80"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-blue/10">
                {linkedBusiness.logo_url ? (
                  <Image
                    src={normalizeMediaUrl(linkedBusiness.logo_url)}
                    alt={linkedBusiness.business_name}
                    width={32}
                    height={32}
                    className="object-cover"
                  />
                ) : (
                  <Building2 className="h-4 w-4 text-brand-blue" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{linkedBusiness.business_name}</p>
                <p className="text-xs text-brand-blue">View Business</p>
              </div>
            </Link>
          )}
          <p className="text-center text-xs text-muted-foreground">
            Posted{" "}
            <time dateTime={promotion.created_at}>
              {new Date(promotion.created_at).toLocaleDateString("en-ZA")}
            </time>
          </p>
        </div>
      </div>

      {/* ═══ SIDEBAR — desktop only (mobile contact shown above) ═══ */}
      <div className="hidden space-y-4 lg:block">
        {/* Price card (when no media overlay) */}
        {promotion.price_cents != null &&
          promotion.price_cents > 0 &&
          photos.length === 0 &&
          videos.length === 0 && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-2xl font-bold">
                    {formatZAR(promotion.price_cents)}
                  </span>
                  {promotion.price_negotiable && (
                    <Badge variant="outline" className="text-brand-green">
                      Negotiable
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

        {/* Advertiser card */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-bold text-white">
                {advertiserProfile?.display_name?.charAt(0)?.toUpperCase() || "A"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {advertiserProfile?.display_name || "Advertiser"}
                </p>
                <TrustBadge level={trustLevel} size="sm" />
              </div>
            </div>

            <Separator />

            {showContactActions ? (
              <PromotionContactActions
                promotionId={promotion.id}
                contactMethods={contactMethods}
                advertiserPhone={
                  contactMethods.includes("call")
                    ? (advertiserProfile?.masked_phone_public ?? null)
                    : null
                }
                advertiserWhatsapp={
                  contactMethods.includes("whatsapp") ? (advertiserProfile?.phone ?? null) : null
                }
              />
            ) : (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Your preview — only you can see this</p>
                <p>Public contact actions appear after approval.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Linked business */}
        {linkedBusiness && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <Link
                href={`/mzansi-business/${linkedBusiness.id}`}
                className="flex items-center gap-3 transition-opacity hover:opacity-80"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-blue/10">
                  {linkedBusiness.logo_url ? (
                    <Image
                      src={normalizeMediaUrl(linkedBusiness.logo_url)}
                      alt={linkedBusiness.business_name}
                      width={32}
                      height={32}
                      className="object-cover"
                    />
                  ) : (
                    <Building2 className="h-4 w-4 text-brand-blue" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{linkedBusiness.business_name}</p>
                  <p className="text-xs text-brand-blue">View Business</p>
                </div>
              </Link>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Posted{" "}
          <time dateTime={promotion.created_at}>
            {new Date(promotion.created_at).toLocaleDateString("en-ZA")}
          </time>
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
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur-md lg:hidden">
          <div className="mx-auto flex max-w-lg gap-3">
            {canCall && (
              <Button
                type="button"
                className="flex-1 gap-2"
                size="lg"
                onClick={() => setShowStickyContact(true)}
              >
                <Phone className="h-4 w-4" />
                {showStickyContact && advertiserProfile?.masked_phone_public
                  ? advertiserProfile.masked_phone_public
                  : "Show Contact"}
              </Button>
            )}

            {canWhatsapp && (showStickyContact || !canCall) && advertiserProfile?.phone && (
              <Button variant="outline" className="flex-1 gap-2" size="lg" asChild>
                <a
                  href={`https://wa.me/${advertiserProfile.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

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
  MapPin,
  Maximize2,
  Play,
  Timer,
  Volume2,
  VolumeX,
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
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";
import {
  PROMOTION_TYPE_LABELS,
  type BusinessCategory,
  type PromotionType,
  type AccountVerificationStatus,
} from "@/types/enums";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { readAccountVerificationStatus } from "@/lib/account/compat";

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
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStart, setLightboxStart] = useState(0);
  const wasPlayingRef = useRef(false);

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

  const enterFullscreen = () => {
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
  const isEvent = promotion.promotion_type === "event";
  const eventState = isEvent ? getEventState(promotion.start_date, promotion.end_date) : null;
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

  // Calendar link (Google Calendar)
  const calendarUrl =
    isEvent && promotion.start_date
      ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(promotion.title)}&dates=${promotion.start_date.replace(/[-:]/g, "").split(".")[0]}Z${promotion.end_date ? `/${promotion.end_date.replace(/[-:]/g, "").split(".")[0]}Z` : ""}&details=${encodeURIComponent(promotion.description?.slice(0, 500) ?? "")}&location=${encodeURIComponent([promotion.location_town, promotion.location_city, promotion.location_province].filter(Boolean).join(", "))}`
      : null;

  return (
    <article className="space-y-4">
      {/* ═══ HERO: Immersive video/photo — portrait on mobile ═══ */}
      {activeMedia && (
        <div className="-mx-4 overflow-hidden rounded-2xl sm:-mx-0">
          <div className="relative aspect-[4/5] overflow-hidden bg-black sm:aspect-[16/9] md:aspect-[2/1]">
            {activeMedia.kind === "video" ? (
              <>
                <video
                  ref={videoRef}
                  src={normalizeMediaUrl(activeMedia.url)}
                  poster={activeMedia.poster ? normalizeMediaUrl(activeMedia.poster) : undefined}
                  autoPlay
                  muted
                  loop
                  playsInline
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  className="absolute inset-0 h-full w-full object-cover"
                  aria-label={`${promotion.title} video`}
                >
                  <track kind="captions" />
                </video>

                {/* Play overlay */}
                {!isPlaying && (
                  <button
                    type="button"
                    onClick={() => {
                      videoRef.current?.play();
                      setIsPlaying(true);
                    }}
                    className="absolute inset-0 z-10 flex items-center justify-center bg-black/20"
                    aria-label="Play video"
                  >
                    <div className="rounded-full bg-white/90 p-4 shadow-xl backdrop-blur-sm">
                      <Play className="h-8 w-8 text-black fill-black" />
                    </div>
                  </button>
                )}

                {/* Mute toggle + fullscreen */}
                <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.muted = !videoRef.current.muted;
                        setIsMuted(videoRef.current.muted);
                      }
                    }}
                    className="rounded-full bg-black/60 p-2.5 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
                    aria-label={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                  </button>
                  <button
                    type="button"
                    onClick={enterFullscreen}
                    className="rounded-full bg-black/60 p-2.5 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
                    aria-label="Fullscreen"
                  >
                    <Maximize2 className="h-5 w-5" />
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="relative w-full h-full cursor-zoom-in"
                onClick={() => openLightbox(activeMediaIndex)}
                aria-label={`View ${promotion.title} photo fullscreen`}
              >
                <Image
                  src={normalizeMediaUrl(activeMedia.url)}
                  alt={promotion.title}
                  fill
                  className="object-cover"
                  sizes="100vw"
                  priority
                />
                <div className="absolute bottom-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm">
                  <Maximize2 className="h-5 w-5" />
                </div>
              </button>
            )}

            {/* Gradient for legibility */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

            {/* Overlay badges */}
            <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
              <Badge className="bg-black/70 text-white backdrop-blur-sm border-0">
                {PROMOTION_TYPE_LABELS[promotion.promotion_type as PromotionType] || "Ads"}
              </Badge>
              {isEvent && eventState && (
                <Badge className={`${EVENT_STATE_BADGE[eventState].className} border-0`}>
                  {EVENT_STATE_BADGE[eventState].label}
                </Badge>
              )}
            </div>

            {/* Price + title overlay at bottom */}
            <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-4">
              <h1 className="font-display text-xl font-bold leading-tight text-white drop-shadow-lg sm:text-2xl">
                {promotion.title}
              </h1>
              <div className="mt-1.5 flex items-center gap-3">
                <span className="flex items-center gap-1 text-xs text-white/80">
                  <MapPin className="h-3 w-3" />
                  {[promotion.location_town, promotion.location_city, promotion.location_province]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                {promotion.price_cents != null && promotion.price_cents > 0 && (
                  <span className="rounded-lg bg-white/20 px-3 py-1 text-sm font-bold text-white backdrop-blur-sm">
                    {formatZAR(promotion.price_cents)}
                    {promotion.price_negotiable && (
                      <span className="ml-1 text-xs font-normal text-brand-green">Neg</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TITLE BAR — fallback when no media hero ═══ */}
      {!activeMedia && (
        <div>
          <h1 className="font-display text-xl font-bold leading-tight sm:text-2xl">
            {promotion.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge className="bg-black/70 text-white backdrop-blur-sm border-0">
              {PROMOTION_TYPE_LABELS[promotion.promotion_type as PromotionType] || "Ads"}
            </Badge>
            {isEvent && eventState && (
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

      {/* ═══ PHOTO/VIDEO GALLERY GRID ═══ */}
      {mediaItems.length > 1 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {mediaItems.map((item, index) => {
            if (index === activeMediaIndex) return null;
            const isVideo = item.kind === "video";
            return (
              <button
                key={`${item.kind}-${index}`}
                type="button"
                onClick={() => setActiveMediaIndex(index)}
                className="group relative aspect-square overflow-hidden rounded-xl ring-2 ring-transparent transition-all hover:shadow-md hover:ring-brand-blue/50"
                aria-label={
                  isVideo
                    ? `View video ${index + 1}`
                    : `View photo ${item.photoNumber ?? index + 1}`
                }
              >
                {isVideo ? (
                  <>
                    {item.poster ? (
                      <Image
                        src={normalizeMediaUrl(item.poster)}
                        alt={`${promotion.title} video thumbnail`}
                        fill
                        className="object-cover transition-transform group-hover:scale-105"
                        sizes="(max-width: 640px) 50vw, 33vw"
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
                    sizes="(max-width: 640px) 50vw, 33vw"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ═══ EVENT COUNTDOWN (compact) ═══ */}
      {isEvent && countdown && (
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
              <dd className="font-medium">
                {PROMOTION_TYPE_LABELS[promotion.promotion_type as PromotionType] ||
                  promotion.promotion_type}
              </dd>

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
                <p className="font-medium text-foreground">Creator preview</p>
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
    </article>
  );
}

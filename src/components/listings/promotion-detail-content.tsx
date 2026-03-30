"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Building2, Calendar, CalendarPlus, Eye, MapPin, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PromotionContactActions } from "@/app/promotion/[id]/promotion-contact-actions";
import { TrustBadge } from "@/components/trust/trust-badge";
import { formatZAR } from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
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
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const activeMedia = mediaItems[activeMediaIndex] ?? null;
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
      ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(promotion.title)}&dates=${promotion.start_date.replace(/[-:]/g, "").split(".")[0]}Z${promotion.end_date ? `/${promotion.end_date.replace(/[-:]/g, "").split(".")[0]}Z` : ""}&details=${encodeURIComponent(promotion.description?.slice(0, 500) ?? "")}&location=${encodeURIComponent(`${promotion.location_city}, ${promotion.location_province}`)}`
      : null;

  return (
    <article className="space-y-6">
      {/* ═══ HERO: Video-first full-bleed media ═══ */}
      {activeMedia && (
        <div className="-mx-4 overflow-hidden rounded-2xl sm:-mx-0">
          <div className="relative aspect-[16/9] overflow-hidden bg-black md:aspect-[2/1]">
            {activeMedia.kind === "video" ? (
              <video
                src={normalizeMediaUrl(activeMedia.url)}
                controls
                playsInline
                preload="metadata"
                poster={activeMedia.poster ? normalizeMediaUrl(activeMedia.poster) : undefined}
                className="h-full w-full bg-black object-contain"
              >
                <track kind="captions" />
              </video>
            ) : (
              <Image
                src={normalizeMediaUrl(activeMedia.url)}
                alt={promotion.title}
                fill
                className="object-cover"
                sizes="100vw"
                priority
              />
            )}
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
            {/* Price overlay */}
            {promotion.price_cents != null && promotion.price_cents > 0 && (
              <div className="absolute bottom-3 right-3">
                <div className="flex items-baseline gap-1.5 rounded-xl bg-black/70 px-4 py-2 backdrop-blur-sm">
                  <span className="font-display text-xl font-bold text-white">
                    {formatZAR(promotion.price_cents)}
                  </span>
                  {promotion.price_negotiable && (
                    <span className="text-xs text-brand-green font-medium">Neg</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Remaining media gallery */}
      {mediaItems.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-hide">
          {mediaItems.map((item, index) => {
            const isActive = activeMediaIndex === index;

            if (item.kind === "video") {
              return (
                <button
                  key={`v-${index}`}
                  type="button"
                  onClick={() => setActiveMediaIndex(index)}
                  className={`relative flex-none w-48 aspect-video overflow-hidden rounded-xl bg-black snap-center border-2 ${
                    isActive ? "border-brand-blue" : "border-transparent"
                  }`}
                  aria-label={`View video ${index + 1}`}
                >
                  <video
                    src={normalizeMediaUrl(item.url)}
                    muted
                    playsInline
                    preload="metadata"
                    poster={item.poster ? normalizeMediaUrl(item.poster) : undefined}
                    className="h-full w-full object-contain"
                  >
                    <track kind="captions" />
                  </video>
                </button>
              );
            }

            return (
              <button
                key={`p-${index}`}
                type="button"
                onClick={() => setActiveMediaIndex(index)}
                className={`relative flex-none w-32 aspect-square overflow-hidden rounded-xl snap-center border-2 ${
                  isActive ? "border-brand-blue" : "border-transparent"
                }`}
                aria-label={`View photo ${item.photoNumber ?? index + 1}`}
              >
                <Image
                  src={normalizeMediaUrl(item.url)}
                  alt={`${promotion.title} photo ${item.photoNumber ?? index + 1}`}
                  fill
                  className="object-cover"
                  sizes="128px"
                />
              </button>
            );
          })}
        </div>
      )}

      {/* ═══ EVENT COUNTDOWN ═══ */}
      {isEvent && countdown && (
        <Card className="border-brand-blue/20 bg-gradient-to-r from-brand-blue/5 to-brand-blue/10">
          <CardContent className="flex flex-col items-center gap-3 p-6 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-brand-blue">
              <Timer className="h-4 w-4" />
              {eventState === "upcoming" ? "Starts in" : "Ends in"}
            </div>
            <div className="flex gap-3 text-center">
              {[
                { value: countdown.days, label: "Days" },
                { value: countdown.hours, label: "Hrs" },
                { value: countdown.minutes, label: "Min" },
                { value: countdown.seconds, label: "Sec" },
              ].map((unit) => (
                <div key={unit.label} className="min-w-[3.5rem]">
                  <div className="font-display text-2xl font-bold tabular-nums">
                    {String(unit.value).padStart(2, "0")}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {unit.label}
                  </div>
                </div>
              ))}
            </div>
            {calendarUrl && (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={calendarUrl} target="_blank" rel="noopener noreferrer">
                  <CalendarPlus className="h-4 w-4" />
                  Add to Calendar
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ CONTENT GRID ═══ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Title + meta (shown on mobile — redundant with hero text for desktop) */}
          <div>
            <h1 className="font-display text-2xl font-bold leading-tight">{promotion.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {categoryLabel && <Badge variant="secondary">{categoryLabel}</Badge>}
              {isEvent && eventState && (
                <Badge className={`${EVENT_STATE_BADGE[eventState].className} border-0`}>
                  {EVENT_STATE_BADGE[eventState].label}
                </Badge>
              )}
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {promotion.location_city}, {promotion.location_province}
              </span>
              <span className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                {promotion.view_count || 0} views
              </span>
            </div>
          </div>

          {/* About */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="font-display text-lg font-bold">About this promotion</h2>
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {promotion.description}
              </p>
            </CardContent>
          </Card>

          {/* Details */}
          <Card>
            <CardContent className="space-y-3 p-6">
              <h2 className="font-display text-lg font-bold">Details</h2>
              <dl className="grid grid-cols-2 gap-y-3 text-sm">
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

                <dt className="text-muted-foreground">Location</dt>
                <dd className="flex items-center gap-1 font-medium">
                  <MapPin className="h-3 w-3" />
                  {promotion.location_city}, {promotion.location_province}
                </dd>

                {promotion.start_date && (
                  <>
                    <dt className="text-muted-foreground">Starts</dt>
                    <dd className="flex items-center gap-1 font-medium">
                      <Calendar className="h-3 w-3" />
                      <time dateTime={promotion.start_date}>
                        {new Date(promotion.start_date).toLocaleDateString("en-ZA", {
                          weekday: "short",
                          year: "numeric",
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
                          year: "numeric",
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
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      {showContactSummary ? "Saved contact methods" : "Contact options"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {contactMethods.map((method) => (
                        <Badge key={method} variant="outline" className="capitalize">
                          {CONTACT_METHOD_LABELS[method] ?? method}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Price card (when no overlay — e.g. no media) */}
          {promotion.price_cents != null &&
            promotion.price_cents > 0 &&
            photos.length === 0 &&
            videos.length === 0 && (
              <Card>
                <CardContent className="space-y-2 p-6">
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
            <CardContent className="space-y-4 p-6">
              <h3 className="font-semibold">Advertiser</h3>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-green font-bold text-white">
                  {advertiserProfile?.display_name?.charAt(0)?.toUpperCase() || "A"}
                </div>
                <div>
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
              <CardContent className="space-y-3 p-5">
                <h3 className="text-sm font-semibold text-muted-foreground">From Business</h3>
                <Link
                  href={`/mzansi-business/${linkedBusiness.id}`}
                  className="flex items-center gap-3 transition-opacity hover:opacity-80"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-blue/10">
                    {linkedBusiness.logo_url ? (
                      <Image
                        src={normalizeMediaUrl(linkedBusiness.logo_url)}
                        alt={linkedBusiness.business_name}
                        width={40}
                        height={40}
                        className="object-cover"
                      />
                    ) : (
                      <Building2 className="h-5 w-5 text-brand-blue" />
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
      </div>
    </article>
  );
}

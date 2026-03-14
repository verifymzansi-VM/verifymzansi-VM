"use client";

import { memo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Clock, Eye, Tag, Calendar, Percent, Sparkles, Maximize2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrustBadge } from "@/components/trust/trust-badge";
import { formatZAR, formatRelativeTime } from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import type { TrustLevel, PromotionType } from "@/types/enums";
import { VideoCardPlayer, isVideoUrl } from "@/components/ui/video-card-player";
import { CountdownBadge } from "@/components/ui/countdown-badge";
import { Lightbox } from "@/components/ui/lightbox";
import { triggerHaptic } from "@/lib/utils/haptics";

interface PromotionCardProps {
  id: string;
  title: string;
  price: number | null;
  negotiable?: boolean;
  imageUrl?: string;
  posterUrl?: string;
  categoryLabel?: string;
  province: string;
  city: string;
  promotionType: PromotionType;
  createdAt: string;
  ownerTrustLevel?: TrustLevel;
  ownerName?: string;
  viewCount?: number;
  boosted?: boolean;
  featured?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  businessName?: string;
}

const TYPE_COLORS: Record<PromotionType, string> = {
  product: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  service: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  event: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  deal: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  general: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

const TYPE_LABELS: Record<PromotionType, string> = {
  product: "Product",
  service: "Service",
  event: "Event",
  deal: "Deal",
  general: "Ad",
};

const TYPE_BORDER_ACCENT: Record<PromotionType, string> = {
  product: "hover:border-emerald-400 dark:hover:border-emerald-600",
  service: "hover:border-blue-400 dark:hover:border-blue-600",
  event: "hover:border-purple-400 dark:hover:border-purple-600",
  deal: "hover:border-red-400 dark:hover:border-red-600",
  general: "hover:border-gray-400 dark:hover:border-gray-600",
};

function getOwnerInitial(name?: string): string {
  if (!name) return "A";
  return name.charAt(0).toUpperCase();
}

function getEventState(startDate?: string | null, endDate?: string | null) {
  const now = new Date();
  const startsAt = startDate ? new Date(startDate) : null;
  const endsAt = endDate ? new Date(endDate) : null;

  if (startsAt && startsAt > now) return "Upcoming";
  if (endsAt && endsAt < now) return "Ended";
  return "Live";
}

const EVENT_STATE_COLORS: Record<string, string> = {
  Upcoming: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  Live: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  Ended: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

export const PromotionCard = memo(function PromotionCard({
  id,
  title,
  price,
  negotiable,
  imageUrl,
  posterUrl,
  categoryLabel,
  province,
  city,
  promotionType,
  createdAt,
  ownerTrustLevel = 0,
  ownerName,
  viewCount,
  boosted,
  featured,
  startDate,
  endDate,
  businessName,
}: PromotionCardProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const normalizedImageUrl = imageUrl ? normalizeMediaUrl(imageUrl) : undefined;
  const normalizedPosterUrl = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;
  const imageIsVideo = isVideoUrl(imageUrl);
  const isEvent = promotionType === "event";
  const isDeal = promotionType === "deal";
  const eventState = isEvent ? getEventState(startDate, endDate) : null;
  const isFree = price == null || price === 0;

  return (
    <Link href={`/promotion/${id}`} className="group block h-full">
      <Card
        className={`h-full overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 flex flex-col ${TYPE_BORDER_ACCENT[promotionType]}`}
        trustLevel={ownerTrustLevel}
      >
        {/* Image area */}
        <div
          className="relative aspect-[4/3] bg-warm-100 dark:bg-warm-800 overflow-hidden shrink-0 cursor-pointer group/preview"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            triggerHaptic("light");
            setIsPreviewOpen(true);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setIsPreviewOpen(true);
            }
          }}
          aria-label="Quick preview media"
        >
          {normalizedImageUrl ? (
            imageIsVideo ? (
              <VideoCardPlayer
                src={imageUrl}
                posterUrl={normalizedPosterUrl}
                alt={title}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                mediaFitClassName="object-contain sm:object-cover"
              />
            ) : (
              <Image
                src={normalizedImageUrl}
                alt={title}
                fill
                className="object-contain sm:object-cover transition-transform duration-500 group-hover:scale-110"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              />
            )
          ) : (
            <div className="flex items-center justify-center h-full text-warm-400 dark:text-warm-500">
              <Tag className="h-6 w-6" />
            </div>
          )}

          {/* Gradient overlay on hover */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

          {/* Quick Preview Icon Hint */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-all duration-300 bg-black/20 pointer-events-none">
            <div className="flex items-center gap-1.5 bg-black/60 text-white px-3 py-1.5 rounded-full backdrop-blur-md transform scale-90 group-hover/preview:scale-100 transition-transform">
              <Maximize2 className="h-4 w-4" />
              <span className="text-xs font-bold">Preview</span>
            </div>
          </div>

          {/* Deal ribbon */}
          {isDeal && (
            <div className="absolute top-0 right-0 z-10">
              <div
                className="bg-red-500 text-white text-[10px] font-bold px-3 py-1 shadow-md flex items-center gap-1"
                style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%, 8px 50%)" }}
              >
                <Percent className="h-2.5 w-2.5" />
                DEAL
              </div>
            </div>
          )}

          {/* Badges overlay (top-left) */}
          <div className="absolute top-2 left-2 flex flex-wrap gap-1">
            {featured && (
              <Badge className="bg-brand-gold text-amber-950 text-[10px] shadow-sm">
                <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                Featured
              </Badge>
            )}
            {boosted && (
              <Badge className="bg-brand-blue text-white text-[10px] shadow-sm">Boosted</Badge>
            )}
            {!isDeal && (
              <Badge className={`text-[10px] ${TYPE_COLORS[promotionType]}`}>
                {TYPE_LABELS[promotionType]}
              </Badge>
            )}
          </div>

          {/* Free badge for events/promos with no price */}
          {isFree && (
            <div className="absolute top-2 right-2 z-10">
              <Badge className="bg-emerald-500 text-white text-[10px] shadow-sm font-bold">
                FREE
              </Badge>
            </div>
          )}

          {/* Trust badge (bottom-right of image) */}
          {ownerTrustLevel > 0 && (
            <div className="absolute bottom-2 right-2">
              <TrustBadge level={ownerTrustLevel} size="sm" />
            </div>
          )}

          {/* Advertiser / owner initial avatar (bottom-left of image) */}
          <div className="absolute bottom-2 left-2 h-7 w-7 rounded-full bg-brand-green text-white text-xs font-bold flex items-center justify-center shadow-md border-2 border-white dark:border-warm-800">
            {getOwnerInitial(ownerName)}
          </div>
        </div>

        <CardContent className="p-3 sm:p-4 space-y-2 flex-1 flex flex-col">
          {/* Event: Calendar date block */}
          {isEvent && startDate && (
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center justify-center w-12 h-12 rounded-lg bg-purple-100 dark:bg-purple-900/50 border border-purple-200 dark:border-purple-800 shrink-0">
                <span className="text-lg font-bold leading-none text-purple-700 dark:text-purple-300">
                  {new Date(startDate).getDate()}
                </span>
                <span className="text-[9px] font-medium uppercase text-purple-600 dark:text-purple-400">
                  {new Date(startDate).toLocaleDateString("en-ZA", { month: "short" })}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-sm line-clamp-2 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors duration-200">
                  {title}
                </h3>
                {eventState && (
                  <Badge className={`mt-1 text-[10px] ${EVENT_STATE_COLORS[eventState]}`}>
                    {eventState}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Non-event: Price + Title */}
          {!isEvent && (
            <>
              {/* Price */}
              {price != null && price > 0 && (
                <div className="flex items-baseline gap-2">
                  <span className="font-display font-bold text-lg text-foreground">
                    {formatZAR(price)}
                  </span>
                  {negotiable && (
                    <span className="text-[10px] font-medium text-brand-green bg-brand-green/10 rounded px-1 py-0.5">
                      Neg.
                    </span>
                  )}
                </div>
              )}

              {/* Title */}
              <h3 className="font-medium text-sm line-clamp-2 group-hover:text-brand-green transition-colors duration-200">
                {title}
              </h3>
            </>
          )}

          {(categoryLabel || businessName) && (
            <div className="flex flex-wrap gap-1.5">
              {categoryLabel && (
                <Badge variant="secondary" className="max-w-full text-[10px]">
                  <span className="truncate">{categoryLabel}</span>
                </Badge>
              )}
              {businessName && (
                <Badge
                  variant="outline"
                  className="max-w-full border-brand-blue/30 text-[10px] text-brand-blue"
                >
                  <span className="truncate">by {businessName}</span>
                </Badge>
              )}
            </div>
          )}

          {/* Event: end date */}
          {isEvent && endDate && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3 text-purple-500" />
              <span>
                Ends{" "}
                <time dateTime={endDate}>
                  {new Date(endDate).toLocaleDateString("en-ZA", {
                    day: "numeric",
                    month: "long",
                  })}
                </time>
              </span>
            </div>
          )}

          {/* Countdown for non-events with end date */}
          {!isEvent && endDate && <CountdownBadge endDate={endDate} />}

          {/* Meta — pushed to bottom */}
          <div className="flex items-center justify-between text-xs text-muted-foreground mt-auto pt-2">
            <span className="flex items-center gap-1 truncate">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              {city}, {province}
            </span>
            <span className="flex items-center gap-1 flex-shrink-0">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(createdAt)}
            </span>
          </div>

          {viewCount !== undefined && viewCount > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Eye className="h-3 w-3" />
              {viewCount} views
            </div>
          )}
        </CardContent>
      </Card>

      <Lightbox
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        imageUrl={imageUrl}
        posterUrl={posterUrl}
        title={title}
      />
    </Link>
  );
});

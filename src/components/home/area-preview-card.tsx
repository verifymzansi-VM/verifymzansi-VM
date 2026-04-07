"use client";

import Link from "next/link";
import { MapPin, Play } from "lucide-react";
import Image from "next/image";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { VideoCardPlayer, isVideoUrl } from "@/components/ui/video-card-player";

interface AreaPreviewCardProps {
  href: string;
  imageUrl?: string;
  posterUrl?: string;
  title: string;
  city: string;
  provinceCode: string;
  description?: string;
  price?: number | null;
  hasVideo?: boolean;
  showViewDetails?: boolean;
  accentColor?: "green" | "gold" | "blue";
  boosted?: boolean;
}

const accentBorder: Record<string, string> = {
  green: "group-hover:border-brand-green-400",
  gold: "group-hover:border-brand-gold-400",
  blue: "group-hover:border-brand-blue-400",
};

const accentBadge: Record<string, string> = {
  green: "bg-brand-green/90 text-white",
  gold: "bg-brand-gold/90 text-warm-950",
  blue: "bg-brand-blue/90 text-white",
};

export function AreaPreviewCard({
  href,
  imageUrl,
  posterUrl,
  title,
  city,
  provinceCode,
  description,
  price,
  hasVideo,
  showViewDetails: _showViewDetails,
  accentColor = "green",
  boosted: _boosted,
}: AreaPreviewCardProps) {
  const isVideo = isVideoUrl(imageUrl);
  const normalizedImageUrl = imageUrl ? normalizeMediaUrl(imageUrl) : undefined;

  const formatPrice = (p: number) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
      maximumFractionDigits: 0,
    }).format(p);

  return (
    <Link
      href={href}
      className={`group block w-full rounded-xl overflow-hidden border border-warm-200 dark:border-warm-700 bg-white dark:bg-warm-900 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1 ${accentBorder[accentColor]}`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] overflow-hidden bg-warm-100 dark:bg-warm-800">
        {normalizedImageUrl ? (
          isVideo ? (
            <VideoCardPlayer
              src={imageUrl}
              posterUrl={posterUrl}
              alt={title}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              mode="ambient"
            />
          ) : (
            <Image
              src={normalizedImageUrl}
              alt={title || "Preview image"}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-110"
            />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div className="h-16 w-24 rounded bg-warm-200 dark:bg-warm-700" />
          </div>
        )}

        {/* Bottom gradient for text readability */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

        {/* Price badge */}
        {price != null && price > 0 && (
          <div className="absolute top-2.5 right-2.5 z-10">
            <span
              className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold shadow-md backdrop-blur-md ${accentBadge[accentColor]}`}
            >
              {formatPrice(price)}
            </span>
          </div>
        )}

        {/* Video play overlay */}
        {hasVideo && !isVideo && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform group-hover:scale-110">
              <Play className="h-4 w-4 fill-white pr-0.5" />
            </div>
          </div>
        )}

        {/* Title on image */}
        <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-2.5">
          <h4 className="text-sm sm:text-base font-bold leading-tight text-white drop-shadow-lg line-clamp-2">
            {title}
          </h4>
        </div>
      </div>

      {/* Info bar */}
      <div className="px-3 py-2.5 space-y-1">
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3 flex-shrink-0" />
          {city}, {provinceCode}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </Link>
  );
}

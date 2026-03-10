"use client";

import Link from "next/link";
import Image from "next/image";
import { MapPin, Zap } from "lucide-react";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { VideoCardPlayer, isVideoUrl } from "@/components/ui/video-card-player";

interface MarketPreviewCardProps {
  href: string;
  imageUrl?: string;
  posterUrl?: string;
  title: string;
  price: number | null;
  city: string;
  provinceCode: string;
  boosted?: boolean;
}

const formatPrice = (p: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(p);

export function MarketPreviewCard({
  href,
  imageUrl,
  posterUrl,
  title,
  price,
  city,
  provinceCode,
  boosted,
}: MarketPreviewCardProps) {
  const isVideo = isVideoUrl(imageUrl);
  const normalizedImageUrl = imageUrl ? normalizeMediaUrl(imageUrl) : undefined;

  return (
    <Link
      href={href}
      className="group block w-full rounded-xl overflow-hidden border border-warm-200 dark:border-warm-700 bg-white dark:bg-warm-900 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-brand-green-400"
      style={{ touchAction: "manipulation" }}
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
            />
          ) : (
            <Image
              src={normalizedImageUrl}
              alt={title || "Product image"}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-110"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div className="h-16 w-24 rounded bg-warm-200 dark:bg-warm-700" />
          </div>
        )}

        {/* Bottom gradient for title */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

        {/* Price badge */}
        {price != null && price > 0 && (
          <div className="absolute top-2.5 right-2.5 z-10">
            <span className="inline-block px-2.5 py-1 rounded-lg text-xs font-bold shadow-md backdrop-blur-md bg-brand-green/90 text-white">
              {formatPrice(price)}
            </span>
          </div>
        )}

        {/* Boosted badge */}
        {boosted && (
          <div className="absolute top-2.5 left-2.5 z-10">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold shadow-md backdrop-blur-md bg-brand-blue/90 text-white">
              <Zap className="h-3 w-3 fill-current" />
              Boosted
            </span>
          </div>
        )}

        {/* Title on image */}
        <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-2.5">
          <h4 className="text-sm font-bold leading-tight text-white drop-shadow-lg line-clamp-1">
            {title}
          </h4>
        </div>
      </div>

      {/* Info bar */}
      <div className="px-3 py-2.5">
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3 flex-shrink-0" />
          {city}, {provinceCode}
        </p>
      </div>
    </Link>
  );
}

"use client";

import { useCallback, useSyncExternalStore, memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Clock, Eye, Heart } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrustBadge } from "@/components/trust/trust-badge";
import { formatZAR, formatRelativeTime } from "@/lib/utils/format";
import { VideoCardPlayer, isVideoUrl } from "@/components/ui/video-card-player";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import type { TrustLevel } from "@/types/enums";
import { getListingConditionLabel } from "@/lib/constants/listing-condition";
import { CATEGORIES } from "@/lib/constants/categories";

interface ListingCardListProps {
  id: string;
  title: string;
  price: number;
  negotiable?: boolean;
  imageUrl?: string;
  posterUrl?: string;
  province: string;
  city: string;
  category: string;
  attributes?: Record<string, unknown>;
  condition?: string;
  createdAt: string;
  sellerTrustLevel?: TrustLevel;
  sellerName?: string;
  viewCount?: number;
  boosted?: boolean;
  featured?: boolean;
  urgent?: boolean;
}

function getSellerInitial(name?: string): string {
  if (!name) return "S";
  return name.charAt(0).toUpperCase();
}

function isNew(createdAt: string): boolean {
  return new Date().getTime() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000;
}

function formatAttributeValue(value: unknown, unit?: string) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (value === null || value === undefined || value === "") {
    return null;
  }

  return unit ? `${String(value)} ${unit}` : String(value);
}

function getAttributeHighlights(category: string, attributes?: Record<string, unknown>) {
  if (!attributes) return [];

  const categoryDefinition = CATEGORIES.find((item) => item.value === category);
  if (!categoryDefinition) return [];

  return categoryDefinition.attributeFields
    .map((field) => {
      const rawValue = attributes[field.name];
      if (rawValue === null || rawValue === undefined || rawValue === "" || rawValue === false) {
        return null;
      }

      if (typeof rawValue === "boolean") {
        return field.label;
      }

      const displayValue = formatAttributeValue(rawValue, field.unit);
      return displayValue ? `${field.label}: ${displayValue}` : null;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 4);
}

export const ListingCardList = memo(function ListingCardList({
  id,
  title,
  price,
  negotiable,
  imageUrl,
  posterUrl,
  province,
  city,
  category,
  attributes,
  condition,
  createdAt,
  sellerTrustLevel = 0,
  sellerName,
  viewCount,
  boosted,
  featured,
  urgent,
}: ListingCardListProps) {
  const isVideo = isVideoUrl(imageUrl);
  const normalizedImageUrl = imageUrl ? normalizeMediaUrl(imageUrl) : undefined;

  // Stable callbacks for useSyncExternalStore — avoids re-subscribing every render
  const subscribeFavs = useCallback((cb: () => void) => {
    window.addEventListener("storage", cb);
    return () => window.removeEventListener("storage", cb);
  }, []);
  const getFavSnapshot = useCallback(() => {
    try {
      const favs: string[] = JSON.parse(localStorage.getItem("vm_favourites") || "[]");
      return favs.includes(id);
    } catch {
      return false;
    }
  }, [id]);
  const getServerSnapshot = useCallback(() => false, []);
  const isFavourited = useSyncExternalStore(subscribeFavs, getFavSnapshot, getServerSnapshot);
  const attributeHighlights = getAttributeHighlights(category, attributes);

  function toggleFavourite(e: React.SyntheticEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const favs: string[] = JSON.parse(localStorage.getItem("vm_favourites") || "[]");
      let updated: string[];
      if (favs.includes(id)) {
        updated = favs.filter((f) => f !== id);
      } else {
        updated = [...favs, id];
      }
      localStorage.setItem("vm_favourites", JSON.stringify(updated));
      // Dispatch storage event for same-tab listeners
      window.dispatchEvent(new StorageEvent("storage", { key: "vm_favourites" }));
    } catch {
      /* ignore */
    }
  }

  const listingIsNew = isNew(createdAt);

  return (
    <Link href={`/listing/${id}`} className="group block">
      <Card
        className="overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5 hover:border-brand-green/30"
        trustLevel={sellerTrustLevel}
      >
        <div className="flex flex-row">
          {/* Left: Image / Video */}
          <div className="relative w-40 sm:w-48 flex-shrink-0 aspect-[4/3] bg-warm-100 dark:bg-warm-800 overflow-hidden">
            {normalizedImageUrl ? (
              isVideo ? (
                <VideoCardPlayer src={imageUrl} posterUrl={posterUrl} alt={title} sizes="192px" />
              ) : (
                <Image
                  src={normalizedImageUrl}
                  alt={title}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-110"
                  sizes="192px"
                />
              )
            ) : (
              <div className="flex items-center justify-center h-full text-warm-400 dark:text-warm-500">
                <span className="text-sm">No image</span>
              </div>
            )}

            {/* Gradient overlay on hover */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            {/* Condition badge (top-left of image) */}
            {condition && (
              <div className="absolute top-2 left-2">
                <Badge
                  variant="secondary"
                  className="text-[10px] backdrop-blur-sm bg-white/80 dark:bg-black/50"
                >
                  {getListingConditionLabel(condition)}
                </Badge>
              </div>
            )}

            {/* Trust badge (bottom-right of image) */}
            {sellerTrustLevel > 0 && (
              <div className="absolute bottom-2 right-2">
                <TrustBadge level={sellerTrustLevel} size="sm" />
              </div>
            )}

            {/* Seller initial avatar (bottom-left of image) */}
            <div className="absolute bottom-2 left-2 h-7 w-7 rounded-full bg-brand-green text-white text-xs font-bold flex items-center justify-center shadow-md border-2 border-white dark:border-warm-800">
              {getSellerInitial(sellerName)}
            </div>
          </div>

          {/* Right: Content */}
          <div className="flex-1 min-w-0 p-3 sm:p-4 flex flex-col justify-between gap-1.5">
            {/* Top row: Price + status badges */}
            <div className="flex items-start justify-between gap-2">
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
              <div className="flex flex-wrap gap-1 flex-shrink-0">
                {featured && (
                  <Badge className="bg-brand-gold text-amber-950 text-[10px] shadow-sm">
                    Featured
                  </Badge>
                )}
                {boosted && (
                  <Badge className="bg-brand-blue text-white text-[10px] shadow-sm">Boosted</Badge>
                )}
                {urgent && (
                  <Badge className="bg-red-500 text-white text-[10px] shadow-sm animate-pulse">
                    Urgent
                  </Badge>
                )}
                {listingIsNew && !featured && !boosted && !urgent && (
                  <Badge className="bg-emerald-500 text-white text-[10px] shadow-sm">NEW</Badge>
                )}
              </div>
            </div>

            {/* Title */}
            <h3 className="font-medium text-sm line-clamp-2 group-hover:text-brand-green transition-colors duration-200">
              {title}
            </h3>

            {/* Category + attribute highlights */}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="text-[10px] capitalize">
                {category.replace(/_/g, " ")}
              </Badge>
              {attributeHighlights.map((highlight) => (
                <Badge key={highlight} variant="outline" className="text-[10px]">
                  {highlight}
                </Badge>
              ))}
            </div>

            {/* Bottom row: location, time, views, favourite */}
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex items-center gap-1 truncate">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  {city}, {province}
                </span>
                <span className="flex items-center gap-1 flex-shrink-0">
                  <Clock className="h-3 w-3" />
                  {formatRelativeTime(createdAt)}
                </span>
                {viewCount !== undefined && (
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <Eye className="h-3 w-3" />
                    {viewCount}
                  </span>
                )}
              </div>

              {/* Favourite button */}
              <div
                role="button"
                tabIndex={0}
                onClick={toggleFavourite}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    toggleFavourite(e);
                  }
                }}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-warm-100 dark:hover:bg-warm-800 transition-all duration-200 z-10 group/fav"
                aria-label={isFavourited ? "Remove from favourites" : "Add to favourites"}
              >
                <Heart
                  className={`h-4 w-4 transition-all duration-200 ${
                    isFavourited
                      ? "fill-red-500 text-red-500 scale-110"
                      : "text-gray-600 dark:text-gray-300 group-hover/fav:text-red-400"
                  }`}
                />
              </div>
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
});

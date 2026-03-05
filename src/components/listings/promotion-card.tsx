"use client";

import { memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Clock, Eye, Tag, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrustBadge } from "@/components/trust/trust-badge";
import { formatZAR, formatRelativeTime } from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import type { TrustLevel, PromotionType } from "@/types/enums";

interface PromotionCardProps {
  id: string;
  title: string;
  price: number | null;
  negotiable?: boolean;
  imageUrl?: string;
  province: string;
  city: string;
  promotionType: PromotionType;
  createdAt: string;
  sellerTrustLevel?: TrustLevel;
  sellerName?: string;
  viewCount?: number;
  boosted?: boolean;
  featured?: boolean;
  endDate?: string | null;
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

function getSellerInitial(name?: string): string {
  if (!name) return "S";
  return name.charAt(0).toUpperCase();
}

export const PromotionCard = memo(function PromotionCard({
  id,
  title,
  price,
  negotiable,
  imageUrl,
  province,
  city,
  promotionType,
  createdAt,
  sellerTrustLevel = 0,
  sellerName,
  viewCount,
  boosted,
  featured,
  endDate,
}: PromotionCardProps) {
  const normalizedImageUrl = imageUrl ? normalizeMediaUrl(imageUrl) : undefined;

  return (
    <Link href={`/promotion/${id}`} className="group block">
      <Card
        className="overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand-green/30"
        trustLevel={sellerTrustLevel}
      >
        {/* Image */}
        <div className="relative aspect-[4/3] bg-warm-100 dark:bg-warm-800 overflow-hidden">
          {normalizedImageUrl ? (
            <Image
              src={normalizedImageUrl}
              alt={title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-110"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-warm-400 dark:text-warm-500">
              <Tag className="h-6 w-6" />
            </div>
          )}

          {/* Gradient overlay on hover */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

          {/* Badges overlay (top-left) */}
          <div className="absolute top-2 left-2 flex flex-wrap gap-1">
            {featured && (
              <Badge className="bg-brand-gold text-amber-950 text-[10px] shadow-sm">Featured</Badge>
            )}
            {boosted && (
              <Badge className="bg-brand-blue text-white text-[10px] shadow-sm">Boosted</Badge>
            )}
            <Badge className={`text-[10px] ${TYPE_COLORS[promotionType]}`}>
              {TYPE_LABELS[promotionType]}
            </Badge>
          </div>

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

        <CardContent className="p-3 sm:p-4 space-y-2">
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

          {/* Meta */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1 truncate">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              {city}, {province}
            </span>
            <span className="flex items-center gap-1 flex-shrink-0">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(createdAt)}
            </span>
          </div>

          {/* End date */}
          {endDate && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              Ends <time dateTime={endDate}>{new Date(endDate).toLocaleDateString("en-ZA")}</time>
            </div>
          )}

          {viewCount !== undefined && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Eye className="h-3 w-3" />
              {viewCount} views
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
});

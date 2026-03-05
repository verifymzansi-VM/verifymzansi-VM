"use client";

import Link from "next/link";
import Image from "next/image";
import { Store, MapPin, Building2, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VideoCardPlayer, isVideoUrl } from "@/components/ui/video-card-player";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

interface MallCardProps {
  id: string;
  name: string;
  coverPhoto?: string | null;
  province: string;
  city: string | null;
  shopCount: number;
  previewCategories?: string[];
  boosted?: boolean;
}

export function MallCard({
  id,
  name,
  coverPhoto,
  province,
  city,
  shopCount,
  previewCategories,
  boosted,
}: MallCardProps) {
  // Video logic
  const isVideo = isVideoUrl(coverPhoto);
  const normalizedCoverPhoto = coverPhoto ? normalizeMediaUrl(coverPhoto) : undefined;

  return (
    <Link href={`/mall-shops/${id}`} className="group block h-full">
      <Card className="h-full overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border-brand-gold/20 hover:border-brand-gold/60 flex flex-col">
        {/* Banner Image / Video */}
        <div className="relative h-36 sm:h-40 bg-gradient-to-br from-brand-gold-50 to-brand-gold-100 dark:from-brand-gold-950 dark:to-brand-gold-900 overflow-hidden shrink-0">
          {normalizedCoverPhoto ? (
            isVideo ? (
              <VideoCardPlayer
                src={coverPhoto}
                alt={name}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                hoverScale={false}
                mediaClassName="transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <Image
                src={normalizedCoverPhoto}
                alt={name}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            )
          ) : (
            <div className="absolute inset-0 flex items-center justify-center opacity-10">
              <Building2 className="w-12 h-12" />
            </div>
          )}

          {/* Gradient overlay for readability */}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
        </div>

        <CardContent className="flex-1 p-5 relative flex flex-col">
          <div className="space-y-2 flex-1 flex flex-col">
            {/* Title */}
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display font-semibold text-lg text-foreground group-hover:text-brand-gold-700 dark:group-hover:text-brand-gold-400 transition-colors line-clamp-1">
                {name}
              </h3>
              {boosted && (
                <Badge className="bg-brand-blue text-white text-[10px] gap-0.5 shrink-0">
                  <Zap className="h-3 w-3 fill-current" />
                  Boosted
                </Badge>
              )}
            </div>

            {/* Location */}
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground/80">
              <MapPin className="h-4 w-4 text-brand-gold" />
              <span className="truncate">
                {city ? `${city}, ` : ""}
                {province}
              </span>
            </div>

            {/* Shop Count & Categories Preview */}
            <div className="pt-3 mt-auto flex flex-wrap items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Store className="h-4 w-4 shrink-0" />
              <span>
                {shopCount} {shopCount === 1 ? "Shop" : "Shops"} Inside
              </span>

              {previewCategories && previewCategories.length > 0 && (
                <>
                  <span className="text-muted-foreground/60">•</span>
                  <span
                    className="text-xs truncate max-w-[140px] sm:max-w-[200px]"
                    title={previewCategories.join(", ")}
                  >
                    {previewCategories.join(", ")}
                  </span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

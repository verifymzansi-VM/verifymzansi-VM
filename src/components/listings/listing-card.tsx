"use client";

import { useState, useCallback, useEffect, useSyncExternalStore, memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Clock, Eye, Heart, Volume2, VolumeX, Maximize2, Play } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrustBadge } from "@/components/trust/trust-badge";
import { formatZAR, formatRelativeTime } from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { useVideoVisibility } from "@/hooks/use-video-visibility";
import type { TrustLevel } from "@/types/enums";

interface ListingCardProps {
  id: string;
  title: string;
  price: number;
  negotiable?: boolean;
  imageUrl?: string;
  posterUrl?: string;
  province: string;
  city: string;
  category: string;
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

export const ListingCard = memo(function ListingCard({
  id,
  title,
  price,
  negotiable,
  imageUrl,
  posterUrl,
  province,
  city,
  category: _category,
  condition,
  createdAt,
  sellerTrustLevel = 0,
  sellerName,
  viewCount,
  boosted,
  featured,
  urgent,
}: ListingCardProps) {
  const isVideo = imageUrl ? /\.(mp4|webm|ogg)(\?|$)/i.test(imageUrl) : false;
  const normalizedImageUrl = imageUrl ? normalizeMediaUrl(imageUrl) : undefined;
  const normalizedPosterUrl = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;
  const { videoRef } = useVideoVisibility(isVideo ? normalizedImageUrl : undefined);
  const [isMuted, setIsMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);

  // Track when video has loaded enough to show frames
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlaying = () => setVideoReady(true);
    el.addEventListener("playing", onPlaying);
    return () => el.removeEventListener("playing", onPlaying);
  });

  const handleVideoActivate = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) videoRef.current.play();
      setIsMuted(false);
      videoRef.current.muted = false;
      try {
        if (videoRef.current.requestFullscreen) {
          videoRef.current.requestFullscreen();
        } else if (
          (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })
            .webkitEnterFullscreen
        ) {
          (
            videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
          ).webkitEnterFullscreen?.();
        }
      } catch (err) {
        console.error("Fullscreen API not supported", err);
      }
    }
  }, [videoRef]);

  const handleVideoClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleVideoActivate();
    },
    [handleVideoActivate]
  );

  const handleVideoKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        handleVideoActivate();
      }
    },
    [handleVideoActivate]
  );

  const toggleMute = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (videoRef.current) {
        videoRef.current.muted = !videoRef.current.muted;
        setIsMuted(videoRef.current.muted);
      }
    },
    [videoRef]
  );

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
    <Link href={`/mzansi-market/${id}`} className="group block">
      <Card
        className="overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand-green/30"
        trustLevel={sellerTrustLevel}
      >
        {/* Image / Video */}
        <div className="relative aspect-[4/3] bg-warm-100 dark:bg-warm-800 overflow-hidden">
          {normalizedImageUrl ? (
            isVideo ? (
              <div className="relative h-full w-full group/video">
                {/* Poster / cover image — prevents blank space before video loads */}
                {normalizedPosterUrl ? (
                  <Image
                    src={normalizedPosterUrl}
                    alt={title || "Video cover"}
                    fill
                    className={`object-cover absolute inset-0 z-[1] transition-opacity duration-300 ${videoReady ? "opacity-0" : "opacity-100"}`}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                  />
                ) : !videoReady ? (
                  <div className="absolute inset-0 z-[1] bg-gradient-to-br from-warm-200 to-warm-300 dark:from-warm-700 dark:to-warm-800 flex items-center justify-center">
                    <Play className="h-10 w-10 text-white/60" />
                  </div>
                ) : null}
                <video
                  ref={videoRef}
                  preload="none"
                  loop
                  muted={isMuted}
                  playsInline
                  className={`h-full w-full object-cover transition-all duration-500 group-hover:scale-110 ${!videoReady ? "opacity-0" : "opacity-100"} z-[2] relative`}
                />
                <div
                  role="button"
                  tabIndex={0}
                  className="absolute inset-0 z-10 hidden group-hover/video:flex flex-col justify-between p-2 bg-black/20"
                  onClick={handleVideoClick}
                  onKeyDown={handleVideoKeyDown}
                >
                  <div className="flex justify-end w-full">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={toggleMute}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          toggleMute(e);
                        }
                      }}
                      className="p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-colors mt-8"
                      aria-label={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </div>
                  </div>
                  <div className="flex items-center justify-center flex-1">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110 mb-8">
                      <Maximize2 className="h-5 w-5" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <Image
                src={normalizedImageUrl}
                alt={title}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-110"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              />
            )
          ) : (
            <div className="flex items-center justify-center h-full text-warm-400">
              <span className="text-sm">No image</span>
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
            {urgent && (
              <Badge className="bg-red-500 text-white text-[10px] shadow-sm animate-pulse">
                Urgent
              </Badge>
            )}
            {listingIsNew && !featured && !boosted && !urgent && (
              <Badge className="bg-emerald-500 text-white text-[10px] shadow-sm">NEW</Badge>
            )}
            {condition && (
              <Badge
                variant="secondary"
                className="text-[10px] backdrop-blur-sm bg-white/80 dark:bg-black/50"
              >
                {condition.replaceAll("_", " ")}
              </Badge>
            )}
          </div>

          {/* Favourite button (top-right) */}
          <div
            role="button"
            tabIndex={0}
            onClick={toggleFavourite}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                toggleFavourite(e);
              }
            }}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-white/80 dark:bg-black/50 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-black/70 transition-all duration-200 z-10 group/fav"
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

          {/* Play indicator */}
          {imageUrl && isVideo && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-100 group-hover:opacity-0 transition-opacity duration-300">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white shadow-lg backdrop-blur-sm">
                <Play className="h-5 w-5 fill-white pr-0.5" />
              </div>
            </div>
          )}
        </div>

        <CardContent className="p-3 sm:p-4 space-y-2">
          {/* Price */}
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

"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Store, MapPin, Volume2, VolumeX, Maximize2, Play } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { TrustBadge } from "@/components/trust/trust-badge";
import { Badge } from "@/components/ui/badge";
import { MALL_SHOP_CATEGORIES } from "@/lib/constants/categories";
import { useVideoVisibility } from "@/hooks/use-video-visibility";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import type { TrustLevel } from "@/types/enums";

interface MallShopCardProps {
  id: string;
  name: string;
  description?: string;
  coverPhoto?: string | null;
  logoUrl?: string | null;
  province: string;
  city: string;
  trustLevel?: TrustLevel;
  category?: string;
}

export function MallShopCard({
  id,
  name,
  description,
  coverPhoto,
  logoUrl,
  province,
  city,
  trustLevel = 0,
  category,
}: MallShopCardProps) {
  const categoryData = MALL_SHOP_CATEGORIES.find((c) => c.value === category);
  const isVideoUrl = (url: string | null | undefined) => {
    if (!url) return false;
    return (
      url
        .split("?")[0]
        .toLowerCase()
        .match(/\.(mp4|webm|ogg)$/) != null
    );
  };
  const isVideo = isVideoUrl(coverPhoto);
  const normalizedCoverPhoto = coverPhoto ? normalizeMediaUrl(coverPhoto) : undefined;
  const { videoRef } = useVideoVisibility(isVideo ? normalizedCoverPhoto : undefined);
  const [isMuted, setIsMuted] = useState(true);
  const normalizedLogoUrl = logoUrl ? normalizeMediaUrl(logoUrl) : undefined;

  const handleVideoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  return (
    <Link href={`/mall-shops/${id}`} className="group block h-full">
      <Card
        className="h-full overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border-brand-gold/20 hover:border-brand-gold/60 flex flex-col"
        trustLevel={trustLevel}
      >
        {/* Banner Image / Video */}
        <div className="relative h-32 sm:h-40 bg-gradient-to-br from-brand-gold-50 to-brand-gold-100 dark:from-brand-gold-950 dark:to-brand-gold-900 overflow-hidden shrink-0">
          {normalizedCoverPhoto ? (
            isVideo ? (
              <div className="relative h-full w-full group/video">
                <video
                  ref={videoRef}
                  preload="none"
                  loop
                  muted={isMuted}
                  playsInline
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                {/* Mobile: always visible controls */}
                <div className="absolute inset-0 z-10 flex sm:hidden flex-col justify-between p-2 bg-black/20">
                  <div className="flex justify-end w-full">
                    <button
                      onClick={toggleMute}
                      className="p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-colors mt-8"
                      aria-label={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-center flex-1">
                    <button
                      onClick={handleVideoClick}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110 mb-6"
                      aria-label="Play video fullscreen"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {/* Desktop: show on hover */}
                <div className="absolute inset-0 z-10 hidden sm:group-hover/video:flex flex-col justify-between p-2 bg-black/20">
                  <div className="flex justify-end w-full">
                    <button
                      onClick={toggleMute}
                      className="p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-colors"
                      aria-label={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-center flex-1">
                    <button
                      onClick={handleVideoClick}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110"
                      aria-label="Play video fullscreen"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {/* Play icon when not hovered */}
                <div className="absolute bottom-2 right-2 z-[5] hidden sm:group-hover/video:hidden sm:flex items-center justify-center rounded-full bg-black/50 p-1.5">
                  <Play className="h-3.5 w-3.5 text-white fill-white" />
                </div>
              </div>
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
              <Store className="w-16 h-16" />
            </div>
          )}

          {/* Trust Badge overlay */}
          {trustLevel > 0 && (
            <div className="absolute top-2 right-2">
              <TrustBadge level={trustLevel} size="sm" />
            </div>
          )}

          {/* Category Badge overlay */}
          {categoryData && (
            <div className="absolute top-2 left-2">
              <Badge className="bg-background/90 backdrop-blur-sm text-foreground hover:bg-background/90 shadow-sm font-medium border-brand-gold/20">
                <categoryData.icon className="w-3 h-3 mr-1 text-brand-gold" />
                {categoryData.label}
              </Badge>
            </div>
          )}
        </div>

        <CardContent className="flex-1 p-5 pt-0 relative flex flex-col">
          {/* Floating Logo/Icon */}
          <div className="relative -mt-8 mb-4">
            <div className="w-16 h-16 rounded-xl border-4 border-background bg-background shadow-sm flex items-center justify-center overflow-hidden transition-transform group-hover:scale-105">
              {normalizedLogoUrl ? (
                <Image src={normalizedLogoUrl} alt={`${name} logo`} fill className="object-cover" />
              ) : (
                <Store className="h-7 w-7 text-brand-gold" />
              )}
            </div>
          </div>

          <div className="space-y-2 flex-1 flex flex-col">
            {/* Title */}
            <h3 className="font-display font-semibold text-lg text-foreground group-hover:text-brand-gold-700 dark:group-hover:text-brand-gold-400 transition-colors line-clamp-1">
              {name}
            </h3>

            {/* Description */}
            {description && (
              <p className="text-sm text-muted-foreground line-clamp-2 flex-1">{description}</p>
            )}

            {/* Location */}
            <div className="pt-3 mt-auto flex items-center gap-1.5 text-xs font-medium text-foreground/80">
              <MapPin className="h-3.5 w-3.5 text-brand-gold" />
              <span className="truncate">
                {city}, {province}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

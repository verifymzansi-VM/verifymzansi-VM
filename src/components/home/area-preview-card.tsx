"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { MapPin, Play, Volume2, VolumeX, Maximize2, Zap } from "lucide-react";
import Image from "next/image";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { useVideoVisibility } from "@/hooks/use-video-visibility";

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
  boosted,
}: AreaPreviewCardProps) {
  const isVideoUrl = (url: string | undefined) => {
    if (!url) return false;
    return (
      url
        .split("?")[0]
        .toLowerCase()
        .match(/\.(mp4|webm|ogg)$/) != null
    );
  };

  const isVideo = isVideoUrl(imageUrl);
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
            <div className="relative h-full w-full group/video">
              {/* Poster / cover image — prevents blank space before video loads */}
              {normalizedPosterUrl ? (
                <Image
                  src={normalizedPosterUrl}
                  alt={title || "Video cover"}
                  fill
                  className={`object-cover absolute inset-0 z-[1] transition-opacity duration-300 ${videoReady ? "opacity-0" : "opacity-100"}`}
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                />
              ) : !videoReady ? (
                <div className="absolute inset-0 z-[1] bg-gradient-to-br from-warm-200 to-warm-300 dark:from-warm-700 dark:to-warm-800 flex items-center justify-center">
                  <Play className="h-8 w-8 text-white/60" />
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
              <div className="absolute inset-0 z-10 flex sm:hidden flex-col justify-between p-2 bg-black/20">
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
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110"
                    aria-label="Play video fullscreen"
                  >
                    <Maximize2 className="h-5 w-5" />
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
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110"
                    aria-label="Play video fullscreen"
                  >
                    <Maximize2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
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

        {/* Boost badge */}
        {boosted && (
          <div className="absolute top-2.5 left-2.5 z-10">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold shadow-md backdrop-blur-md bg-brand-blue/90 text-white">
              <Zap className="h-3 w-3 fill-current" />
              Boosted
            </span>
          </div>
        )}

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
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform group-hover:scale-110">
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

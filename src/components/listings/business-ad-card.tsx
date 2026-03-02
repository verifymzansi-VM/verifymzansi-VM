"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Briefcase,
  Globe,
  User,
  CheckCircle2,
  Zap,
  Volume2,
  VolumeX,
  Maximize2,
  Play,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrustBadge } from "@/components/trust/trust-badge";
import { BUSINESS_AD_CATEGORIES } from "@/lib/constants/categories";
import { useVideoVisibility } from "@/hooks/use-video-visibility";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import type { TrustLevel } from "@/types/enums";

interface BusinessAdCardProps {
  id: string;
  name: string;
  about?: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  servicesOffered?: string[];
  website?: string | null;
  trustLevel?: TrustLevel;
  sellerName?: string;
  category?: string;
  boosted?: boolean;
}

export function BusinessAdCard({
  id,
  name,
  about,
  logoUrl,
  coverUrl,
  servicesOffered,
  website,
  trustLevel = 0,
  sellerName,
  category,
  boosted,
}: BusinessAdCardProps) {
  const categoryData = BUSINESS_AD_CATEGORIES.find((c) => c.value === category);

  // Video logic
  const isVideoUrl = (url: string | null | undefined) => {
    if (!url) return false;
    return (
      url
        .split("?")[0]
        .toLowerCase()
        .match(/\.(mp4|webm|ogg)$/) != null
    );
  };
  const isVideo = isVideoUrl(coverUrl);
  const normalizedCoverUrl = coverUrl ? normalizeMediaUrl(coverUrl) : undefined;
  const { videoRef } = useVideoVisibility(isVideo ? normalizedCoverUrl : undefined);
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
    <Link href={`/business-ads/${id}`} className="group block h-full">
      <Card
        className="h-full flex flex-col overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-brand-blue/30 bg-background"
        trustLevel={trustLevel}
      >
        {/* Banner Image / Video */}
        <div className="relative aspect-[4/3] bg-brand-blue-50 dark:bg-brand-blue-950 overflow-hidden shrink-0">
          {normalizedCoverUrl ? (
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
                <div
                  className="absolute inset-0 z-10 hidden group-hover/video:flex flex-col justify-between p-2 bg-black/20"
                  role="presentation"
                  onClick={handleVideoClick}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ")
                      handleVideoClick(e as unknown as React.MouseEvent);
                  }}
                >
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
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110 mb-8">
                      <Maximize2 className="h-5 w-5" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <Image
                src={normalizedCoverUrl}
                alt={`${name} cover`}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              />
            )
          ) : (
            <div className="absolute inset-0 flex items-center justify-center opacity-10">
              <Briefcase className="w-16 h-16" />
            </div>
          )}

          {/* Gradient overlay for readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

          {/* Boost Badge */}
          <div className="absolute top-2 left-2 flex flex-wrap gap-1 z-10">
            {boosted && (
              <Badge className="bg-brand-blue text-white text-[10px] shadow-sm">
                <Zap className="h-3 w-3 fill-current mr-0.5" /> Boosted
              </Badge>
            )}
          </div>

          {/* Trust Badge */}
          {trustLevel > 0 && (
            <div className="absolute top-2 right-2 z-10">
              <TrustBadge level={trustLevel} size="sm" />
            </div>
          )}

          {/* Play indicator */}
          {coverUrl && isVideo && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-100 group-hover:opacity-0 transition-opacity duration-300">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white shadow-lg backdrop-blur-sm">
                <Play className="h-5 w-5 fill-white pr-0.5" />
              </div>
            </div>
          )}

          {/* Logo inset overlay */}
          <div className="absolute -bottom-6 left-4 z-20">
            <div className="w-14 h-14 rounded-lg border-2 border-white dark:border-warm-900 shadow-md bg-white dark:bg-warm-800 flex items-center justify-center overflow-hidden">
              {normalizedLogoUrl ? (
                <Image
                  src={normalizedLogoUrl}
                  alt={`${name} logo`}
                  fill
                  className="object-cover"
                  sizes="56px"
                />
              ) : (
                <Briefcase className="h-6 w-6 text-brand-blue/50" />
              )}
            </div>
          </div>
        </div>

        <CardContent className="pt-8 pb-5 px-5 flex-1 flex flex-col">
          <div className="mb-2">
            <h3 className="font-display font-semibold text-lg text-foreground group-hover:text-brand-blue-700 transition-colors line-clamp-1">
              {name}
            </h3>
            {categoryData && (
              <div className="flex items-center text-xs text-muted-foreground mt-0.5">
                <categoryData.icon className="w-3.5 h-3.5 mr-1 text-brand-blue/70" />
                {categoryData.label}
              </div>
            )}
          </div>

          {about && (
            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed mb-3">
              {about}
            </p>
          )}

          {/* Services Tags */}
          {servicesOffered && servicesOffered.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-auto mb-4">
              {servicesOffered.slice(0, 3).map((service, idx) => (
                <Badge
                  key={idx}
                  variant="secondary"
                  className="text-[10px] bg-brand-blue/5 text-brand-blue-800 dark:text-brand-blue-300 border hover:bg-brand-blue/10 font-medium py-0.5"
                >
                  <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-500/70" />
                  {service}
                </Badge>
              ))}
              {servicesOffered.length > 3 && (
                <span className="text-[10px] text-muted-foreground flex items-center pl-1 font-medium">
                  +{servicesOffered.length - 3} more
                </span>
              )}
            </div>
          )}

          {/* Meta Footer */}
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground mt-auto pt-3 border-t">
            {sellerName ? (
              <span className="flex items-center gap-1.5 truncate">
                <User className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{sellerName}</span>
              </span>
            ) : (
              <span />
            )}

            {website ? (
              <span className="flex items-center gap-1.5 text-brand-blue hover:text-brand-blue-700 transition-colors shrink-0">
                <Globe className="h-3.5 w-3.5" />
                Website
              </span>
            ) : (
              <span className="flex items-center gap-1.5 opacity-50 shrink-0">
                <Globe className="h-3.5 w-3.5" />
                No Website
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

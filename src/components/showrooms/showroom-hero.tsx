"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  MapPin,
  Building2,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Square,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ENTITY_CONFIG = {
  storefront: {
    Icon: Building2,
    badgeColor: "bg-amber-700 text-amber-50 border-amber-600 backdrop-blur-md",
    badge: "Mall Shop",
    href: "/mzansi-business/",
    cta: "Visit Shop",
  },
  business: {
    Icon: Building2,
    badgeColor: "bg-blue-700 text-blue-50 border-blue-600 backdrop-blur-md",
    badge: "Mzansi Business",
    href: "/mzansi-business/",
    cta: "View Business",
  },
  listing: {
    Icon: ShieldCheck,
    badgeColor: "bg-emerald-700 text-emerald-50 border-emerald-600 backdrop-blur-md",
    badge: "Mzansi Market",
    href: "/listing/",
    cta: "View Listing",
  },
};

export interface ShowroomSlide {
  id: string;
  type: "storefront" | "business" | "listing";
  title: string;
  description: string;
  location: string;
  mediaUrl: string;
  posterUrl?: string;
  price?: number | null;
  promotions?: Record<string, unknown>[];
  hrefOverride?: string;
  ctaLabelOverride?: string;
  badgeLabelOverride?: string;
}

interface ShowroomHeroProps {
  slides: ShowroomSlide[];
  fallbackTitle?: string;
  fallbackDescription?: string;
  fallbackMedia?: string;
}

/* ── Extracted to module scope to avoid re-creating on every render ── */
function isVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  return (
    url
      .split("?")[0]
      .toLowerCase()
      .match(/\.(mp4|webm|ogg)$/) != null
  );
}

function ShowroomMediaRender({
  src,
  alt,
  className,
  posterUrl,
}: {
  src: string;
  alt?: string;
  className: string;
  posterUrl?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const isVideo = isVideoUrl(src);

  // Sync play state with video events
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => {
      setIsPlaying(true);
      setIsStopped(false);
    };
    const onPause = () => setIsPlaying(false);
    const onPlaying = () => setVideoReady(true);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("playing", onPlaying);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("playing", onPlaying);
    };
  });

  const togglePlayPause = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!videoRef.current) return;
    if (isStopped) {
      setIsStopped(false);
      setVideoReady(false);
      videoRef.current.currentTime = 0;
      videoRef.current.src = src;
      videoRef.current.play().catch(() => {});
      return;
    }
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  };

  const handleStop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!videoRef.current) return;
    videoRef.current.pause();
    videoRef.current.removeAttribute("src");
    videoRef.current.load();
    setIsStopped(true);
    setIsPlaying(false);
    setVideoReady(false);
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  if (isVideo) {
    const showPoster = posterUrl && (isStopped || !videoReady);

    return (
      <div className="relative h-full w-full group/video">
        {/* Poster / cover image — prevents blank space */}
        {showPoster && (
          <Image
            src={posterUrl}
            alt={alt || "Video cover"}
            fill
            className="object-cover absolute inset-0 w-full h-full z-[1]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 800px"
            priority
          />
        )}
        {/* Gradient fallback when no poster */}
        {!posterUrl && !videoReady && (
          <div className="absolute inset-0 z-[1] bg-gradient-to-br from-warm-300 to-warm-400 dark:from-warm-700 dark:to-warm-800 flex items-center justify-center">
            <Play className="h-12 w-12 text-white/50" />
          </div>
        )}

        {/* Video element */}
        {!isStopped && (
          <video
            ref={videoRef}
            src={src}
            autoPlay
            loop
            muted={isMuted}
            playsInline
            preload="metadata"
            aria-label="Showroom background video"
            className={cn(
              "object-cover absolute inset-0 w-full h-full",
              showPoster || (!posterUrl && !videoReady) ? "opacity-0" : "opacity-100",
              "transition-opacity duration-300 z-[2]"
            )}
          />
        )}
        {/* Stopped — hidden video ref for restart */}
        {isStopped && <video ref={videoRef} className="hidden" />}

        {/* Mobile controls (always visible) */}
        <div className="absolute inset-0 z-10 flex sm:hidden flex-col justify-between p-3 bg-black/20">
          <div className="flex justify-end w-full">
            <button
              onClick={toggleMute}
              className="p-2 rounded-full bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-colors"
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex items-center justify-center flex-1 gap-3">
            <button
              onClick={togglePlayPause}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-5 w-5 fill-white" />
              ) : (
                <Play className="h-5 w-5 fill-white" />
              )}
            </button>
            {!isStopped && (
              <button
                onClick={handleStop}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110"
                aria-label="Stop"
              >
                <Square className="h-4 w-4 fill-white" />
              </button>
            )}
          </div>
        </div>

        {/* Desktop controls (hover to show, always visible when paused/stopped) */}
        <div
          className={cn(
            "absolute inset-0 z-10 hidden sm:flex flex-col justify-between p-3 bg-black/20 transition-opacity",
            isPlaying ? "opacity-0 group-hover/video:opacity-100" : "opacity-100"
          )}
        >
          <div className="flex justify-end w-full">
            <button
              onClick={toggleMute}
              className="p-2 rounded-full bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-colors"
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex items-center justify-center flex-1 gap-3">
            <button
              onClick={togglePlayPause}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-5 w-5 fill-white" />
              ) : (
                <Play className="h-5 w-5 fill-white" />
              )}
            </button>
            {!isStopped && (
              <button
                onClick={handleStop}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110"
                aria-label="Stop"
              >
                <Square className="h-4 w-4 fill-white" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt || "Media thumbnail"}
      className={className}
      width={800}
      height={600}
      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 800px"
    />
  );
}

export function ShowroomHero({
  slides: initialSlides = [],
  fallbackTitle,
  fallbackDescription,
  fallbackMedia,
}: ShowroomHeroProps) {
  const [current, setCurrent] = useState(0);
  const [fading, setFading] = useState(false);

  const slides = useMemo<ShowroomSlide[]>(() => {
    if (initialSlides.length === 0) {
      return [
        {
          id: "placeholder",
          type: "listing",
          title: fallbackTitle || "Welcome to VerifyMzansi Showroom",
          description:
            fallbackDescription ||
            "Explore fully verified sellers, businesses, and mall shops directly.",
          location: "South Africa",
          mediaUrl: fallbackMedia || "/images/fallbacks/hero-shop.svg",
          price: null,
          promotions: [],
        },
      ];
    }
    return initialSlides;
  }, [initialSlides, fallbackTitle, fallbackDescription, fallbackMedia]);

  const goTo = useCallback(
    (index: number) => {
      if (index === current) return;
      setFading(true);
      setTimeout(() => {
        setCurrent(index);
        setFading(false);
      }, 280);
    },
    [current]
  );

  const next = useCallback(
    () => goTo((current + 1) % Math.max(1, slides.length)),
    [current, goTo, slides.length]
  );

  const prev = useCallback(
    () => goTo((current - 1 + slides.length) % Math.max(1, slides.length)),
    [current, goTo, slides.length]
  );

  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const id = setInterval(() => nextRef.current(), 8000);
    return () => clearInterval(id);
  }, [slides.length]);

  const activeSlide = slides[current] || null;
  const activeConfig = activeSlide
    ? ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]
    : undefined;
  const activeHref =
    activeSlide && (activeSlide.hrefOverride || `${activeConfig?.href || "/"}${activeSlide.id}`);
  const activeCta = activeSlide?.ctaLabelOverride || activeConfig?.cta || "View";
  const activeBadge = activeSlide?.badgeLabelOverride || activeConfig?.badge || "";
  const ActiveIcon = activeConfig?.Icon || Building2;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
      maximumFractionDigits: 0,
    }).format(price);
  };

  return (
    <div className="w-full">
      <div className="relative overflow-hidden w-full">
        {/* === Image area — clean, no overlay on mobile === */}
        <div className="relative bg-warm-100 dark:bg-warm-900 w-full aspect-[16/10] sm:aspect-[3/1]">
          {activeSlide && (
            <>
              <div
                className={`absolute inset-0 transition-opacity duration-700 ${fading ? "opacity-0" : "opacity-100"}`}
              >
                <ShowroomMediaRender
                  src={activeSlide.mediaUrl}
                  alt={activeSlide.title}
                  className="w-full h-full object-cover"
                  posterUrl={activeSlide.posterUrl}
                />
              </div>

              {/* Desktop (sm+): subtle gradient for overlay readability */}
              <div className="hidden sm:block absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/60 via-black/20 to-transparent pointer-events-none z-10" />

              {/* Desktop (sm+): glassmorphism info overlay */}
              <div className="hidden sm:flex absolute inset-0 z-20 container-page items-end pb-8">
                <div
                  className={`max-w-lg lg:max-w-xl bg-black/35 backdrop-blur-xl rounded-2xl border border-white/15 p-5 lg:p-6 space-y-2.5 transition-all duration-700 transform ${fading ? "opacity-0 translate-y-6" : "opacity-100 translate-y-0"}`}
                >
                  {activeSlide.promotions && activeSlide.promotions.length > 0 && (
                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-red-500/90 text-white text-xs font-bold animate-pulse">
                      🔥 {String(activeSlide.promotions[0].title ?? "")}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.badgeColor || "bg-gray-500 text-white"}`}
                    >
                      <ActiveIcon className="h-3 w-3" />
                      {activeBadge}
                    </span>
                    {activeSlide.location && (
                      <span className="flex items-center gap-1 text-white/80 text-xs">
                        <MapPin className="h-3 w-3 text-brand-green-400" /> {activeSlide.location}
                      </span>
                    )}
                    {activeSlide.price !== null && activeSlide.price !== undefined && (
                      <span className="text-brand-gold-400 text-sm font-bold">
                        {formatPrice(activeSlide.price)}
                      </span>
                    )}
                  </div>

                  <h2 className="font-display text-2xl lg:text-3xl font-bold text-white leading-tight">
                    {activeSlide.title}
                  </h2>
                  <p className="text-sm text-white/70 leading-snug line-clamp-2">
                    {activeSlide.description}
                  </p>

                  <Link
                    href={activeHref}
                    className={cn(
                      buttonVariants({ size: "sm" }),
                      "h-10 px-5 text-sm bg-brand-green hover:bg-brand-green-600 text-white font-bold gap-2 rounded-full mt-1"
                    )}
                  >
                    {activeCta}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </>
          )}

          {/* Slide navigation dots + arrows */}
          {slides.length > 1 && (
            <div className="absolute bottom-2.5 sm:bottom-6 right-3 sm:right-0 sm:left-0 sm:container-page z-30 flex items-center justify-end pointer-events-none">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="flex gap-1.5 pointer-events-auto">
                  {slides.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => goTo(i)}
                      aria-label={`Go to slide ${i + 1}`}
                      className={`rounded-full transition-all duration-300 ${
                        i === current
                          ? "w-5 h-1.5 sm:w-6 sm:h-2 bg-brand-green-400"
                          : "w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white/50 hover:bg-white/90"
                      }`}
                    />
                  ))}
                </div>
                <div className="flex gap-1 sm:gap-1.5 pointer-events-auto">
                  <button
                    type="button"
                    onClick={prev}
                    aria-label="Previous slide"
                    className="rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-md border border-white/10 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-white transition-all"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    aria-label="Next slide"
                    className="rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-md border border-white/10 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-white transition-all"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* === Mobile ONLY: clean info strip below the image === */}
        {activeSlide && (
          <div
            className={`sm:hidden bg-white dark:bg-warm-900 border-b border-warm-100 dark:border-warm-800 transition-opacity duration-500 ${fading ? "opacity-0" : "opacity-100"}`}
          >
            <div className="px-4 py-3 space-y-1.5">
              <div className="flex items-center flex-wrap gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.badgeColor || "bg-gray-500 text-white"}`}
                >
                  <ActiveIcon className="h-2.5 w-2.5" />
                  {activeBadge}
                </span>
                {activeSlide.location && (
                  <span className="flex items-center gap-1 text-muted-foreground text-xs">
                    <MapPin className="h-3 w-3" /> {activeSlide.location}
                  </span>
                )}
                {activeSlide.price !== null && activeSlide.price !== undefined && (
                  <span className="text-brand-green-600 dark:text-brand-green-400 text-sm font-bold ml-auto">
                    {formatPrice(activeSlide.price)}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-base font-bold text-foreground leading-tight truncate">
                    {activeSlide.title}
                  </h2>
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                    {activeSlide.description}
                  </p>
                </div>
                <Link
                  href={activeHref}
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "shrink-0 h-8 px-3 text-xs bg-brand-green hover:bg-brand-green-600 text-white font-bold gap-1 rounded-full"
                  )}
                >
                  {activeCta}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

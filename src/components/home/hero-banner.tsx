"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  MapPin,
  Building2,
  Megaphone,
  ShoppingBag,
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
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { useVideoVisibility } from "@/hooks/use-video-visibility";
import { PromoVideoSlide } from "./promo-video-slide";

// Map types to their appropriate icon and styling
const ENTITY_CONFIG = {
  business: {
    Icon: Building2,
    badgeColor: "bg-blue-700 text-blue-50 border-blue-600 backdrop-blur-md",
    badge: "Mzansi Business",
    href: "/mzansi-business/",
    cta: "View Business",
  },
  promotion: {
    Icon: Megaphone,
    badgeColor: "bg-orange-700 text-orange-50 border-orange-600 backdrop-blur-md",
    badge: "Promotions & Events",
    href: "/promotion/",
    cta: "View Promotion",
  },
  listing: {
    Icon: ShieldCheck,
    badgeColor: "bg-emerald-700 text-emerald-50 border-emerald-600 backdrop-blur-md",
    badge: "Mzansi Market",
    href: "/listing/",
    cta: "View Listing",
  },
};

const HERO_CATEGORY_LINKS = [
  {
    href: "/mzansi-market",
    label: "Mzansi Market",
    icon: ShoppingBag,
    iconColor: "text-brand-green",
    hoverClass:
      "hover:border-brand-green/40 hover:bg-brand-green-50 dark:hover:border-brand-green/50",
  },
  {
    href: "/mzansi-business",
    label: "Mzansi Business",
    icon: Building2,
    iconColor: "text-brand-blue",
    hoverClass: "hover:border-brand-blue/40 hover:bg-brand-blue-50 dark:hover:border-brand-blue/50",
  },
  {
    href: "/promotions",
    label: "Promotions & Events",
    icon: Megaphone,
    iconColor: "text-red-500",
    hoverClass: "hover:border-red-400/40 hover:bg-red-50 dark:hover:border-red-500/50",
  },
] as const;

interface HeroPromotion {
  type?: string;
  title: string;
  valid_until?: string | null;
}

interface HeroBusiness {
  id: string;
  business_name: string;
  description?: string;
  location_city?: string;
  cover_video?: string | null;
  cover_photo?: string | null;
  video_thumbnail?: string | null;
}

interface HeroListing {
  id: string;
  title: string;
  description?: string;
  location_city?: string;
  videos?: string[];
  photos?: string[];
  price_cents?: number | null;
  video_thumbnail?: string | null;
}

interface HeroPromotionRecord {
  id: string;
  title: string;
  description?: string;
  location_city?: string;
  videos?: string[];
  photos?: string[];
  video_thumbnail?: string | null;
  price_cents?: number | null;
}

interface HeroSlide {
  type: string;
  id: string;
  title: string;
  description: string;
  location: string;
  mediaUrl: string;
  posterUrl?: string;
  promotions: HeroPromotion[];
  price: number | null;
}

interface HeroBannerProps {
  topBusinesses?: HeroBusiness[];
  latestListings?: HeroListing[];
  latestPromotions?: HeroPromotionRecord[];
}

/** Check if a URL points to a video file (by extension). */
function isVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  return (
    url
      .split("?")[0]
      .toLowerCase()
      .match(/\.(mp4|webm|ogg)$/) != null
  );
}

/** Extract a location string from various possible shapes. */
function extractLocation(loc: unknown): string {
  if (!loc) return "South Africa";
  if (typeof loc === "string") return loc;
  if (Array.isArray(loc)) return (loc[0] as string) || "South Africa";
  if (typeof loc === "object" && loc !== null) {
    const obj = loc as Record<string, unknown>;
    if (obj.regions && Array.isArray(obj.regions) && obj.regions.length > 0)
      return obj.regions[0] as string;
    if (typeof obj.city === "string") return obj.city;
  }
  return "South Africa";
}

/**
 * Renders media (video or image) for a hero slide.
 * Extracted to module scope so React doesn't unmount/remount on every render.
 */
function MediaRender({
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
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const isVideo = isVideoUrl(src);
  const { videoRef, reducedMotion: _reducedMotion } = useVideoVisibility(
    isVideo && !isStopped ? src : undefined
  );

  const togglePlayPause = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!videoRef.current) return;

    if (isStopped) {
      setIsStopped(false);
      videoRef.current.currentTime = 0;
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
    videoRef.current.currentTime = 0;
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

  // Sync isPlaying state with video events
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
  }, [videoRef]);

  const handleVideoError = () => {
    setHasError(true);
    setVideoReady(false);
  };

  if (isVideo) {
    // Show poster when video hasn't started playing yet, when stopped, or on error
    const showPoster = posterUrl && (isStopped || !videoReady || hasError);

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
        {/* Gradient fallback when no poster available */}
        {!posterUrl && !videoReady && (
          <div className="absolute inset-0 z-[1] bg-gradient-to-br from-warm-300 to-warm-400 dark:from-warm-700 dark:to-warm-800 flex items-center justify-center">
            <Play className="h-12 w-12 text-white/50" />
          </div>
        )}

        {/* Video element */}
        {!isStopped && !hasError && (
          <video
            ref={videoRef}
            loop
            muted={isMuted}
            playsInline
            preload="none"
            aria-label={alt ? `${alt} video` : "Hero banner video"}
            onError={handleVideoError}
            className={cn(
              "object-cover absolute inset-0 w-full h-full",
              showPoster || (!posterUrl && !videoReady) ? "opacity-0" : "opacity-100",
              "transition-opacity duration-300 z-[2]"
            )}
          />
        )}

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

export function HeroBanner({
  topBusinesses = [],
  latestListings = [],
  latestPromotions = [],
}: HeroBannerProps) {
  const [current, setCurrent] = useState(0);
  const [fading, setFading] = useState(false);

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

  // extractLocation is defined at module scope (no component state dependencies)

  const slides = useMemo<HeroSlide[]>(() => {
    const combined: HeroSlide[] = [
      ...topBusinesses.map((b) => {
        const usesVideo = !!b.cover_video;
        return {
          type: "business" as const,
          id: b.id,
          title: b.business_name,
          description: b.description || "Trusted local business.",
          location: extractLocation(b.location_city),
          mediaUrl: normalizeMediaUrl(
            b.cover_video || b.cover_photo || "/images/fallbacks/hero-business.svg"
          ),
          posterUrl:
            usesVideo && (b.video_thumbnail || b.cover_photo)
              ? normalizeMediaUrl(b.video_thumbnail || b.cover_photo || "")
              : undefined,
          promotions: [],
          price: null,
        };
      }),
      ...latestListings.map((l) => {
        const usesVideo = !!(l.videos && l.videos.length > 0);
        const posterSrc = l.video_thumbnail || (l.photos && l.photos.length > 0 ? l.photos[0] : "");
        return {
          type: "listing" as const,
          id: l.id,
          title: l.title,
          description: l.description || "Exclusive verified listing.",
          location: l.location_city || "South Africa",
          mediaUrl: normalizeMediaUrl(
            usesVideo
              ? l.videos![0]
              : l.photos && l.photos.length > 0
                ? l.photos[0]
                : "/images/fallbacks/hero-listing.svg"
          ),
          posterUrl: usesVideo && posterSrc ? normalizeMediaUrl(posterSrc) : undefined,
          promotions: [],
          price: l.price_cents ? l.price_cents / 100 : null,
        };
      }),
      ...latestPromotions.map((promotion) => {
        const usesVideo = !!(promotion.videos && promotion.videos.length > 0);
        const posterSrc =
          promotion.video_thumbnail ||
          (promotion.photos && promotion.photos.length > 0 ? promotion.photos[0] : "");
        return {
          type: "promotion" as const,
          id: promotion.id,
          title: promotion.title,
          description: promotion.description || "Latest promotion from a verified advertiser.",
          location: promotion.location_city || "South Africa",
          mediaUrl: normalizeMediaUrl(
            usesVideo
              ? promotion.videos![0]
              : promotion.photos && promotion.photos.length > 0
                ? promotion.photos[0]
                : "/images/fallbacks/hero-listing.svg"
          ),
          posterUrl: usesVideo && posterSrc ? normalizeMediaUrl(posterSrc) : undefined,
          promotions: [],
          price: promotion.price_cents ? promotion.price_cents / 100 : null,
        };
      }),
    ];

    if (combined.length === 0) {
      combined.push({
        type: "promo" as const,
        id: "promo-default",
        title: "Welcome to VerifyMzansi",
        description: "South Africa's trusted verification-first marketplace",
        location: "South Africa",
        mediaUrl: "__promo__",
        promotions: [],
        price: null,
      });
    }

    return combined;
  }, [topBusinesses, latestListings, latestPromotions]);

  const next = () => goTo((current + 1) % Math.max(1, slides.length));
  const prev = () => goTo((current - 1 + slides.length) % Math.max(1, slides.length));

  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = () => goTo((current + 1) % Math.max(1, slides.length));
  }, [current, goTo, slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const isPromo = slides[current]?.type === "promo";
    const interval = isPromo ? 20000 : 8000;
    const id = setInterval(() => nextRef.current(), interval);
    return () => clearInterval(id);
  }, [slides.length, current, slides]);

  const activeSlide = slides[current] || null;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
      maximumFractionDigits: 0,
    }).format(price);
  };

  return (
    <div className="w-full">
      {/* ── Hero Showroom ── */}
      <div className="relative border-b border-warm-200 dark:border-warm-800 overflow-hidden">
        {/* === Image area — clean, no overlay on mobile === */}
        <div className="relative bg-warm-100 dark:bg-warm-900 aspect-[2/1] sm:aspect-[3/1] overflow-hidden">
          {activeSlide && (
            <>
              <div
                className={`absolute inset-0 transition-opacity duration-700 ${fading ? "opacity-0" : "opacity-100"}`}
              >
                {activeSlide.type === "promo" ? (
                  <PromoVideoSlide />
                ) : (
                  <MediaRender
                    src={activeSlide.mediaUrl}
                    alt={activeSlide.title}
                    className="w-full h-full object-cover"
                    posterUrl={activeSlide.posterUrl}
                  />
                )}
              </div>

              {/* Desktop (sm+): subtle gradient for overlay readability */}
              {activeSlide.type !== "promo" && (
                <div className="hidden sm:block absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/60 via-black/20 to-transparent pointer-events-none z-10" />
              )}

              {/* Desktop (sm+): glassmorphism info overlay */}
              {activeSlide.type !== "promo" && (
                <div className="hidden sm:flex absolute inset-0 z-20 container-page items-end pb-6 lg:pb-8">
                  <div
                    className={`max-w-lg lg:max-w-xl bg-black/35 backdrop-blur-xl rounded-2xl border border-white/15 p-5 lg:p-6 space-y-2.5 transition-all duration-700 transform ${fading ? "opacity-0 translate-y-6" : "opacity-100 translate-y-0"}`}
                  >
                    {activeSlide.promotions && activeSlide.promotions.length > 0 && (
                      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-red-500/90 text-white text-xs font-bold animate-pulse">
                        <span role="img" aria-label="Hot deal">
                          🔥
                        </span>{" "}
                        {activeSlide.promotions[0].title}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.badgeColor || "bg-gray-500 text-white"}`}
                      >
                        {(() => {
                          const Icon =
                            ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.Icon ||
                            Building2;
                          return <Icon className="h-3 w-3" />;
                        })()}
                        {ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.badge}
                      </span>
                      {activeSlide.location && (
                        <span className="flex items-center gap-1 text-white/80 text-xs">
                          <MapPin className="h-3 w-3 text-brand-green-400" /> {activeSlide.location}
                        </span>
                      )}
                      {activeSlide.price !== null && (
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
                      href={`${ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.href}${activeSlide.id}`}
                      className={cn(
                        buttonVariants({ size: "sm" }),
                        "h-10 px-5 text-sm bg-brand-green hover:bg-brand-green-600 text-white font-bold gap-2 rounded-full mt-1"
                      )}
                    >
                      {ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.cta || "View"}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Slide navigation dots + arrows */}
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
        </div>

        {/* === Mobile ONLY: clean info strip below the image === */}
        {activeSlide && activeSlide.type !== "promo" && (
          <div
            className={`sm:hidden bg-white dark:bg-warm-900 border-b border-warm-100 dark:border-warm-800 transition-opacity duration-500 ${fading ? "opacity-0" : "opacity-100"}`}
          >
            <div className="px-4 py-3 space-y-1.5">
              <div className="flex items-center flex-wrap gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.badgeColor || "bg-gray-500 text-white"}`}
                >
                  {(() => {
                    const Icon =
                      ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.Icon ||
                      Building2;
                    return <Icon className="h-2.5 w-2.5" />;
                  })()}
                  {ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.badge}
                </span>
                {activeSlide.location && (
                  <span className="flex items-center gap-1 text-muted-foreground text-xs">
                    <MapPin className="h-3 w-3" /> {activeSlide.location}
                  </span>
                )}
                {activeSlide.price !== null && (
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
                  href={`${ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.href}${activeSlide.id}`}
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "shrink-0 h-8 px-3 text-xs bg-brand-green hover:bg-brand-green-600 text-white font-bold gap-1 rounded-full"
                  )}
                >
                  {ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.cta || "View"}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Category Strip ── */}
      <div className="bg-white dark:bg-warm-900 border-b border-warm-200 dark:border-warm-800 shadow-sm">
        <div className="container-page py-3">
          <nav
            aria-label="Marketplace categories"
            className="mx-auto grid max-w-4xl grid-cols-3 gap-2 sm:gap-3"
          >
            {HERO_CATEGORY_LINKS.map((category) => {
              const Icon = category.icon;

              return (
                <Link
                  key={category.href}
                  href={category.href}
                  className={cn(
                    "flex min-h-[58px] items-center justify-center rounded-2xl border border-warm-200 bg-warm-50 px-3 py-3 text-center text-sm font-semibold leading-tight text-foreground transition-colors dark:border-warm-700 dark:bg-warm-800 dark:hover:bg-warm-700 sm:min-h-[60px] sm:text-base",
                    category.hoverClass
                  )}
                >
                  <span className="flex items-center justify-center gap-2 whitespace-normal">
                    <Icon
                      aria-hidden="true"
                      className={cn("h-4 w-4 shrink-0", category.iconColor)}
                    />
                    <span>{category.label}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}

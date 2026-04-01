"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Building2, Megaphone, ArrowRight, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/shared/brand-logo";
import { buttonVariants } from "@/components/ui/button";
import { VideoCardPlayer, isVideoUrl } from "@/components/ui/video-card-player";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
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
  logo_url?: string | null;
  cover_video?: string | null;
  cover_photo?: string | null;
  video_thumbnail?: string | null;
}

interface HeroListing {
  id: string;
  title: string;
  description?: string;
  location_city?: string;
  logo_url?: string | null;
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
  logoUrl?: string;
  promotions: HeroPromotion[];
  price: number | null;
}

interface HeroBannerProps {
  topBusinesses?: HeroBusiness[];
  latestListings?: HeroListing[];
  latestPromotions?: HeroPromotionRecord[];
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

export function HeroBanner({
  topBusinesses = [],
  latestListings = [],
  latestPromotions = [],
}: HeroBannerProps) {
  const [current, setCurrent] = useState(0);
  const [fading, setFading] = useState(false);
  const [isActiveVideoPaused, setIsActiveVideoPaused] = useState(false);

  const goTo = useCallback(
    (index: number) => {
      if (index === current) return;
      setFading(true);
      setTimeout(() => {
        setIsActiveVideoPaused(false);
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
          description:
            b.description || "Promote your trusted business to more South African customers.",
          location: extractLocation(b.location_city),
          mediaUrl: normalizeMediaUrl(
            b.cover_video || b.cover_photo || "/images/fallbacks/hero-business.svg"
          ),
          posterUrl:
            usesVideo && (b.video_thumbnail || b.cover_photo)
              ? normalizeMediaUrl(b.video_thumbnail || b.cover_photo || "")
              : undefined,
          logoUrl: b.logo_url ? normalizeMediaUrl(b.logo_url) : undefined,
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
          description: l.description || "Highlight products and services with trusted visibility.",
          location: l.location_city || "South Africa",
          mediaUrl: normalizeMediaUrl(
            usesVideo
              ? l.videos![0]
              : l.photos && l.photos.length > 0
                ? l.photos[0]
                : "/images/fallbacks/hero-listing.svg"
          ),
          posterUrl: usesVideo && posterSrc ? normalizeMediaUrl(posterSrc) : undefined,
          logoUrl: l.logo_url ? normalizeMediaUrl(l.logo_url) : undefined,
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
        title: "Promote your business with trust",
        description:
          "South Africa's platform for business visibility, brand promotion, and verification-first confidence.",
        location: "South Africa",
        mediaUrl: "__promo__",
        promotions: [],
        price: null,
      });
    }

    return combined;
  }, [topBusinesses, latestListings, latestPromotions]);

  const next = useCallback(
    () => goTo((current + 1) % Math.max(1, slides.length)),
    [current, goTo, slides.length]
  );
  const prev = useCallback(
    () => goTo((current - 1 + slides.length) % Math.max(1, slides.length)),
    [current, goTo, slides.length]
  );

  const touchStartX = useRef(0);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.changedTouches[0].clientX;
  }, []);
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const delta = e.changedTouches[0].clientX - touchStartX.current;
      if (delta > 50) prev();
      else if (delta < -50) next();
    },
    [prev, next]
  );

  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = () => goTo((current + 1) % Math.max(1, slides.length));
  }, [current, goTo, slides.length]);

  useEffect(() => {
    if (slides.length <= 1 || isActiveVideoPaused) return;
    const isPromo = slides[current]?.type === "promo";
    const interval = isPromo ? 20000 : 8000;
    const id = setInterval(() => nextRef.current(), interval);
    return () => clearInterval(id);
  }, [slides.length, current, slides, isActiveVideoPaused]);

  const activeSlide = slides[current] || null;
  const activeSlideIsVideo = activeSlide ? isVideoUrl(activeSlide.mediaUrl) : false;
  const activeLogoUrl = activeSlide?.logoUrl ?? null;

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
        <div
          className="relative bg-warm-100 dark:bg-warm-900 aspect-[2/1] overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {activeSlide && (
            <>
              <div
                className={`absolute inset-0 transition-opacity duration-700 ${fading ? "opacity-0" : "opacity-100"}`}
              >
                {activeSlide.type === "promo" ? (
                  <PromoVideoSlide />
                ) : (
                  <VideoCardPlayer
                    src={activeSlide.mediaUrl}
                    posterUrl={activeSlide.posterUrl}
                    alt={activeSlide.title}
                    sizes="100vw"
                    mode="ambient"
                    muteControlVisibility="always"
                    showPlaybackControl={activeSlideIsVideo}
                    onPlaybackStateChange={(isPlaying) => setIsActiveVideoPaused(!isPlaying)}
                    priority
                    mediaClassName="scale-[1.01]"
                  />
                )}
              </div>
            </>
          )}

          {activeSlide ? (
            <div
              className={cn(
                "pointer-events-none absolute bottom-3 right-3 z-20 transition-opacity duration-500 sm:bottom-5 sm:right-5",
                fading ? "opacity-0" : "opacity-100"
              )}
            >
              <div
                className="flex min-h-[44px] items-center rounded-full border border-white/12 bg-black/45 px-2.5 py-1.5 shadow-[0_18px_36px_-22px_rgba(15,23,42,0.92)] backdrop-blur-md"
                data-testid="showroom-logo-tag"
              >
                {activeLogoUrl ? (
                  <div className="relative h-8 w-[72px] sm:h-9 sm:w-[88px]">
                    <Image
                      src={activeLogoUrl}
                      alt={`${activeSlide.title} logo tag`}
                      fill
                      sizes="(max-width: 640px) 72px, 88px"
                      className="object-contain"
                      unoptimized
                    />
                  </div>
                ) : (
                  <BrandLogo
                    size="sm"
                    tone="inverse"
                    className="w-[92px] sm:w-[108px]"
                    imageClassName="drop-shadow-none"
                  />
                )}
              </div>
            </div>
          ) : null}

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
            </div>
          </div>
        </div>

        {/* === Shared info strip below the image === */}
        {activeSlide && activeSlide.type !== "promo" && (
          <div
            className={`bg-white dark:bg-warm-900 border-b border-warm-100 dark:border-warm-800 transition-opacity duration-500 ${fading ? "opacity-0" : "opacity-100"}`}
          >
            <div className="px-4 py-3 space-y-2 sm:px-6 sm:py-4 lg:px-8 lg:py-5">
              {activeSlide.promotions && activeSlide.promotions.length > 0 && (
                <div className="inline-flex items-center gap-2 rounded-full bg-red-500/90 px-2.5 py-1 text-xs font-bold text-white">
                  <span role="img" aria-label="Hot deal">
                    🔥
                  </span>
                  {activeSlide.promotions[0].title}
                </div>
              )}

              <div className="flex items-center flex-wrap gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:px-3 sm:py-1 sm:text-[11px] sm:tracking-[0.16em] ${ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.badgeColor || "bg-gray-500 text-white"}`}
                >
                  {(() => {
                    const Icon =
                      ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.Icon ||
                      Building2;
                    return <Icon className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5" />;
                  })()}
                  {ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.badge}
                </span>
                {activeSlide.location && (
                  <span className="flex items-center gap-1 text-muted-foreground text-xs sm:text-sm">
                    <MapPin className="h-3 w-3" /> {activeSlide.location}
                  </span>
                )}
                {activeSlide.price !== null && (
                  <span className="text-brand-green-600 dark:text-brand-green-400 text-sm font-bold ml-auto sm:text-base">
                    {formatPrice(activeSlide.price)}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-base font-bold text-foreground leading-tight truncate sm:text-xl lg:text-2xl">
                    {activeSlide.title}
                  </h2>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground sm:text-sm lg:text-base">
                    {activeSlide.description}
                  </p>
                </div>
                <Link
                  href={`${ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.href}${activeSlide.id}`}
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "shrink-0 h-8 px-3 text-xs bg-brand-green hover:bg-brand-green-600 text-white font-bold gap-1 rounded-full sm:h-10 sm:px-5 sm:text-sm sm:gap-2"
                  )}
                >
                  {ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG]?.cta || "View"}
                  <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

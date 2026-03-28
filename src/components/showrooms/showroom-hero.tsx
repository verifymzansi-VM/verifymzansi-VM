"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type TouchEvent } from "react";
import Link from "next/link";
import {
  MapPin,
  Building2,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { VideoCardPlayer } from "@/components/ui/video-card-player";
import { cn } from "@/lib/utils";

const ENTITY_CONFIG = {
  storefront: {
    Icon: Building2,
    badgeColor: "bg-amber-500/90 text-amber-950 border border-amber-200/40",
    badge: "Mall Shop",
    href: "/mzansi-business/",
    cta: "Visit Shop",
  },
  business: {
    Icon: Building2,
    badgeColor: "bg-brand-blue/90 text-white border border-white/10",
    badge: "Mzansi Business",
    href: "/mzansi-business/",
    cta: "View Business",
  },
  listing: {
    Icon: ShieldCheck,
    badgeColor: "bg-brand-green/90 text-white border border-white/10",
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

export function ShowroomHero({
  slides: initialSlides = [],
  fallbackTitle,
  fallbackDescription,
  fallbackMedia,
}: ShowroomHeroProps) {
  const [current, setCurrent] = useState(0);
  const [fading, setFading] = useState(false);
  const touchStartX = useRef(0);

  const slides = useMemo<ShowroomSlide[]>(() => {
    if (initialSlides.length === 0) {
      return [
        {
          id: "placeholder",
          type: "listing",
          title: fallbackTitle || "Welcome to VerifyMzansi Showroom",
          description:
            fallbackDescription ||
            "Explore verified accounts, businesses, and mall shops directly.",
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
      }, 240);
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

  const handleTouchStart = useCallback((event: TouchEvent) => {
    touchStartX.current = event.changedTouches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      const delta = event.changedTouches[0].clientX - touchStartX.current;
      if (delta > 50) prev();
      if (delta < -50) next();
    },
    [next, prev]
  );

  const activeSlide = slides[current] || null;

  const formatPrice = (price: number) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
      maximumFractionDigits: 0,
    }).format(price);

  if (!activeSlide) {
    return null;
  }

  const activeConfig = ENTITY_CONFIG[activeSlide.type as keyof typeof ENTITY_CONFIG];
  const activeHref = activeSlide.hrefOverride || `${activeConfig.href}${activeSlide.id}`;
  const activeCta = activeSlide.ctaLabelOverride || activeConfig.cta;
  const activeBadge = activeSlide.badgeLabelOverride || activeConfig.badge;
  const ActiveIcon = activeConfig.Icon;

  return (
    <section className="w-full">
      <div className="relative overflow-hidden border-b border-warm-200 dark:border-warm-800">
        <div
          className="relative aspect-[2/1] w-full overflow-hidden bg-warm-100 dark:bg-warm-900 sm:aspect-[16/7] lg:aspect-[21/8]"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className={cn(
              "absolute inset-0 transition-opacity duration-500",
              fading ? "opacity-0" : "opacity-100"
            )}
          >
            <VideoCardPlayer
              src={activeSlide.mediaUrl}
              posterUrl={activeSlide.posterUrl}
              alt={activeSlide.title}
              sizes="100vw"
              mode="ambient"
              muteControlVisibility="always"
              priority
              mediaClassName="scale-[1.01]"
            />
          </div>

          <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-t from-black/72 via-black/24 to-transparent sm:block" />
          <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-black/28 via-transparent to-transparent sm:block" />

          <div className="absolute inset-0 z-10 hidden items-end sm:flex">
            <div className="container-page pb-6 lg:pb-8">
              <div
                className={cn(
                  "max-w-lg space-y-2.5 rounded-2xl border border-white/15 bg-black/35 p-5 backdrop-blur-xl transition-all duration-500 lg:max-w-xl lg:p-6",
                  fading ? "translate-y-4 opacity-0" : "translate-y-0 opacity-100"
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] shadow-sm backdrop-blur-md",
                      activeConfig?.badgeColor
                    )}
                  >
                    <ActiveIcon className="h-3.5 w-3.5" />
                    {activeBadge}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-white/80">
                    <MapPin className="h-3 w-3 text-brand-green-400" />
                    {activeSlide.location}
                  </span>
                  {activeSlide.price != null ? (
                    <span className="text-sm font-bold text-brand-gold-400">
                      {formatPrice(activeSlide.price)}
                    </span>
                  ) : null}
                </div>

                <h2 className="font-display text-2xl font-bold leading-tight text-white lg:text-3xl">
                  {activeSlide.title}
                </h2>

                <p className="max-w-lg text-sm leading-snug text-white/72 line-clamp-2">
                  {activeSlide.description}
                </p>

                <Link
                  href={activeHref}
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "h-10 rounded-full bg-brand-green px-5 text-sm font-bold text-white hover:bg-brand-green-600"
                  )}
                >
                  {activeCta}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>

          {slides.length > 1 ? (
            <div className="absolute bottom-2.5 right-3 z-20 flex items-center justify-end sm:bottom-6 sm:right-0 sm:left-0 sm:container-page">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="flex gap-1.5">
                  {slides.map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => goTo(index)}
                      aria-label={`Go to slide ${index + 1}`}
                      className={cn(
                        "rounded-full transition-all duration-300",
                        index === current
                          ? "h-1.5 w-5 bg-brand-green-400 sm:h-2 sm:w-6"
                          : "h-1.5 w-1.5 bg-white/50 hover:bg-white/90 sm:h-2 sm:w-2"
                      )}
                    />
                  ))}
                </div>

                <div className="hidden gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={prev}
                    aria-label="Previous slide"
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-white/10 bg-black/30 text-white backdrop-blur-md transition-colors hover:bg-black/45"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    aria-label="Next slide"
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-white/10 bg-black/30 text-white backdrop-blur-md transition-colors hover:bg-black/45"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            "border-t border-warm-100 bg-white transition-opacity duration-500 dark:border-warm-800 dark:bg-warm-900 sm:hidden",
            fading ? "opacity-0" : "opacity-100"
          )}
        >
          <div className="space-y-1.5 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  activeConfig?.badgeColor
                )}
              >
                <ActiveIcon className="h-2.5 w-2.5" />
                {activeBadge}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {activeSlide.location}
              </span>
              {activeSlide.price != null ? (
                <span className="ml-auto text-sm font-bold text-brand-green-600 dark:text-brand-green-400">
                  {formatPrice(activeSlide.price)}
                </span>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-base font-bold leading-tight text-foreground">
                  {activeSlide.title}
                </h2>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                  {activeSlide.description}
                </p>
              </div>

              <Link
                href={activeHref}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "h-8 shrink-0 rounded-full bg-brand-green px-3 text-xs font-bold text-white hover:bg-brand-green-600"
                )}
              >
                {activeCta}
                <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

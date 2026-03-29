"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type TouchEvent } from "react";
import Link from "next/link";
import { MapPin, Building2, ArrowRight, ShieldCheck } from "lucide-react";
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
    badgeColor: "bg-brand-green text-white border border-white/10",
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

          {slides.length > 1 ? (
            <div className="absolute bottom-2.5 right-3 z-20 flex items-center justify-end sm:bottom-6 sm:right-0 sm:left-0 sm:container-page">
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
                  ></button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            "border-t border-warm-100 bg-white transition-opacity duration-500 dark:border-warm-800 dark:bg-warm-900",
            fading ? "opacity-0" : "opacity-100"
          )}
        >
          <div className="space-y-2 px-4 py-3 sm:px-6 sm:py-4 lg:px-8 lg:py-5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:px-3 sm:py-1 sm:text-[11px] sm:tracking-[0.16em]",
                  activeConfig?.badgeColor
                )}
              >
                <ActiveIcon className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5" />
                {activeBadge}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground sm:text-sm">
                <MapPin className="h-3 w-3" />
                {activeSlide.location}
              </span>
              {activeSlide.price != null ? (
                <span className="ml-auto text-sm font-bold text-brand-green-600 dark:text-brand-green-400 sm:text-base">
                  {formatPrice(activeSlide.price)}
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-base font-bold leading-tight text-foreground sm:text-xl lg:text-2xl">
                  {activeSlide.title}
                </h2>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground sm:text-sm lg:text-base">
                  {activeSlide.description}
                </p>
              </div>

              <Link
                href={activeHref}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "h-8 shrink-0 rounded-full bg-brand-green px-3 text-xs font-bold text-white hover:bg-brand-green-600 sm:h-10 sm:px-5 sm:text-sm"
                )}
              >
                {activeCta}
                <ArrowRight className="ml-1 h-3 w-3 sm:ml-1.5 sm:h-4 sm:w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

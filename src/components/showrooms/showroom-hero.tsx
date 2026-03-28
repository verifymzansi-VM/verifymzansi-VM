"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
    <section className="relative overflow-hidden bg-black">
      <div className="relative aspect-[9/12] w-full sm:aspect-[16/7] lg:aspect-[21/8]">
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

        <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/28 to-black/6" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/36 via-transparent to-transparent" />

        <div className="absolute inset-x-0 bottom-0 z-10">
          <div className="container-page pb-5 pt-24 sm:pb-8 sm:pt-28 lg:pb-10">
            <div
              className={cn(
                "max-w-xl space-y-3 transition-all duration-500",
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
                {activeSlide.price != null ? (
                  <span className="rounded-full bg-white/12 px-3 py-1 text-sm font-semibold text-white backdrop-blur-md">
                    {formatPrice(activeSlide.price)}
                  </span>
                ) : null}
              </div>

              <h2 className="font-display text-2xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
                {activeSlide.title}
              </h2>

              <p className="max-w-lg text-sm leading-relaxed text-white/78 line-clamp-2 sm:text-base">
                {activeSlide.description}
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-white/76">
                  <MapPin className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{activeSlide.location}</span>
                </p>
                <Link
                  href={activeHref}
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "h-10 rounded-full bg-white text-slate-950 hover:bg-white/90 px-4 font-semibold"
                  )}
                >
                  {activeCta}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {slides.length > 1 ? (
          <div className="absolute inset-x-0 bottom-4 z-20 sm:bottom-6">
            <div className="container-page flex items-center justify-between">
              <div className="flex gap-1.5">
                {slides.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => goTo(index)}
                    aria-label={`Go to slide ${index + 1}`}
                    className={cn(
                      "h-2 rounded-full transition-all duration-300",
                      index === current ? "w-8 bg-white" : "w-2 bg-white/45 hover:bg-white/75"
                    )}
                  />
                ))}
              </div>

              <div className="flex gap-2">
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
    </section>
  );
}

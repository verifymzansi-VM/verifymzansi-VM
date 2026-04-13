"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type TouchEvent,
  type KeyboardEvent,
} from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
import { cn } from "@/lib/utils";
import type { TrustLevel } from "@/types/enums";

/* ── Types ─────────────────────────────────────────────────── */

export interface CarouselItem {
  id: string;
  type: "listing" | "business" | "promotion";
  href: string;
  title: string;
  description?: string;
  location?: string;
  mediaUrl?: string;
  posterUrl?: string;
  logoUrl?: string;
  price?: number | null;
  eyebrow?: string | null;
  statusLabel?: string | null;
  statusClassName?: string;
  focalX?: number | null;
  focalY?: number | null;
  trustLevel?: TrustLevel;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
}

export interface ShowroomCardCarouselProps {
  items: CarouselItem[];
  autoSwipeMs?: number;
  pauseOnInteractionMs?: number;
  className?: string;
  /** Fallback title when items is empty */
  emptyTitle?: string;
  /** Fallback description when items is empty */
  emptyDescription?: string;
}

/* ── Constants ─────────────────────────────────────────────── */

const DEFAULT_AUTO_SWIPE_MS = 5000;
const DEFAULT_PAUSE_MS = 7000;
const SWIPE_THRESHOLD = 50;
const VISIBILITY_THRESHOLD = 0.25;

/* ── Component ─────────────────────────────────────────────── */

export function ShowroomCardCarousel({
  items,
  autoSwipeMs = DEFAULT_AUTO_SWIPE_MS,
  pauseOnInteractionMs = DEFAULT_PAUSE_MS,
  className,
  emptyTitle = "Welcome to VerifyMzansi",
  emptyDescription = "Explore verified businesses, listings, and events.",
}: ShowroomCardCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef(0);
  const pausedRef = useRef(false);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const count = items.length;

  /* ── Navigation helpers ────────────────────────────────── */

  const goTo = useCallback(
    (index: number) => {
      if (count <= 1) return;
      setActiveIndex(((index % count) + count) % count);
    },
    [count]
  );

  const next = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
  const prev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);

  /* ── Interaction pause ─────────────────────────────────── */

  const pauseAutoSwipe = useCallback(() => {
    pausedRef.current = true;
    if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
    pauseTimeoutRef.current = setTimeout(() => {
      pausedRef.current = false;
    }, pauseOnInteractionMs);
  }, [pauseOnInteractionMs]);

  /* ── Touch swipe ───────────────────────────────────────── */

  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartX.current = e.changedTouches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      const delta = e.changedTouches[0].clientX - touchStartX.current;
      if (Math.abs(delta) < SWIPE_THRESHOLD) return;
      pauseAutoSwipe();
      if (delta > 0) prev();
      else next();
    },
    [next, prev, pauseAutoSwipe]
  );

  /* ── Keyboard ──────────────────────────────────────────── */

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        pauseAutoSwipe();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        pauseAutoSwipe();
        next();
      }
    },
    [next, prev, pauseAutoSwipe]
  );

  /* ── Visibility gating (IntersectionObserver) ──────────── */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setIsVisible(entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD),
      { threshold: [VISIBILITY_THRESHOLD, 0.5] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ── Auto-swipe timer ──────────────────────────────────── */

  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);

  useEffect(() => {
    if (count <= 1 || reducedMotion || !isVisible) return;
    const id = setInterval(() => {
      if (!pausedRef.current) nextRef.current();
    }, autoSwipeMs);
    return () => clearInterval(id);
  }, [autoSwipeMs, count, isVisible, reducedMotion]);

  /* ── Cleanup ───────────────────────────────────────────── */

  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
    };
  }, []);

  /* ── Render helpers ────────────────────────────────────── */

  /** Compute the shortest signed offset from `activeIndex` to `i` on a circular track. */
  function signedOffset(i: number): number {
    const raw = i - activeIndex;
    if (count <= 1) return 0;
    const half = count / 2;
    if (raw > half) return raw - count;
    if (raw < -half) return raw + count;
    return raw;
  }

  function cardClass(offset: number): string {
    const transitionClass = reducedMotion
      ? "transition-none"
      : "transition-all duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)]";

    const byOffset: Record<number, string> = {
      [-3]: "translate-x-[calc(-50%-100%)] scale-[0.68] opacity-0 z-0 pointer-events-none",
      [-2]: "translate-x-[calc(-50%-100%)] scale-[0.68] opacity-[0.55] z-10",
      [-1]: "translate-x-[calc(-50%-55%)] scale-[0.82] opacity-[0.85] z-20",
      0: "-translate-x-1/2 scale-100 opacity-100 z-30",
      1: "translate-x-[calc(-50%+55%)] scale-[0.82] opacity-[0.85] z-20",
      2: "translate-x-[calc(-50%+100%)] scale-[0.68] opacity-[0.55] z-10",
      3: "translate-x-[calc(-50%+100%)] scale-[0.68] opacity-0 z-0 pointer-events-none",
    };

    const preset = byOffset[offset] ?? byOffset[Math.sign(offset) * 3] ?? byOffset[0];

    return cn("absolute left-1/2 top-0", transitionClass, preset);
  }

  /* ── Empty state ───────────────────────────────────────── */

  if (count === 0) {
    return (
      <section
        className={cn(
          "w-full bg-gradient-to-b from-warm-950 via-warm-900 to-warm-950 py-8 sm:py-10 lg:py-12 dark:from-black dark:via-warm-950 dark:to-black",
          className
        )}
        aria-roledescription="carousel"
        aria-label="Showroom carousel"
      >
        <div className="container-page flex items-center justify-center">
          <div className="w-[52vw] sm:w-[40vw] lg:w-[252px] xl:w-[288px]">
            <PosterCardShell
              href="#"
              title={emptyTitle}
              description={emptyDescription}
              location="South Africa"
              mediaUrl="/images/fallbacks/hero-shop.svg"
            />
          </div>
        </div>
      </section>
    );
  }

  /* ── Main render ───────────────────────────────────────── */

  return (
    <section
      ref={containerRef}
      className={cn(
        "w-full bg-gradient-to-b from-warm-950 via-warm-900 to-warm-950 py-6 sm:py-8 lg:py-10 dark:from-black dark:via-warm-950 dark:to-black",
        className
      )}
      aria-roledescription="carousel"
      aria-label="Showroom carousel"
    >
      {/* Card coverflow area */}
      <div
        className="relative mx-auto overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-label="Carousel slides"
      >
        {/* Height-establishing invisible card (defines container height from center card) */}
        <div
          className="invisible w-[52vw] sm:w-[40vw] lg:w-[252px] xl:w-[288px] mx-auto"
          aria-hidden="true"
        >
          <PosterCardShell
            href="#"
            title="Verified Marketplace Listing Placeholder"
            description="Placeholder description"
            location="South Africa"
            eyebrow="R 0"
            mediaUrl="/images/fallbacks/hero-shop.svg"
          />
        </div>

        {/* Absolutely positioned coverflow cards */}
        {items.map((item, i) => {
          const offset = signedOffset(i);
          if (Math.abs(offset) > 3) return null;

          return (
            <div
              key={item.id}
              className={cn("w-[52vw] sm:w-[40vw] lg:w-[252px] xl:w-[288px]", cardClass(offset))}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
            >
              <PosterCardShell
                href={item.href}
                title={item.title}
                description={item.description}
                location={item.location}
                mediaUrl={item.mediaUrl}
                posterUrl={item.posterUrl}
                logoUrl={item.logoUrl}
                eyebrow={item.eyebrow}
                statusLabel={item.statusLabel}
                statusClassName={item.statusClassName}
                trustLevel={item.trustLevel}
                focalX={item.focalX}
                focalY={item.focalY}
                mediaWidth={item.mediaWidth}
                mediaHeight={item.mediaHeight}
                priority={offset === 0}
              />
            </div>
          );
        })}
      </div>

      {/* Navigation dots */}
      {count > 1 && (
        <div
          className="mt-4 flex items-center justify-center gap-1.5"
          role="group"
          aria-label="Slide controls"
        >
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                pauseAutoSwipe();
                goTo(i);
              }}
              aria-label={`Go to slide ${i + 1}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full"
            >
              <span
                className={cn(
                  "rounded-full transition-all duration-300",
                  i === activeIndex
                    ? "h-1.5 w-5 bg-brand-green-400 sm:h-2 sm:w-6"
                    : "h-1.5 w-1.5 bg-white/50 hover:bg-white/90 sm:h-2 sm:w-2"
                )}
              />
            </button>
          ))}
        </div>
      )}
      {/* Screen-reader live announcer */}
      {count > 1 && (
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {`Slide ${activeIndex + 1} of ${count}`}
        </div>
      )}
    </section>
  );
}

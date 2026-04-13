"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent,
} from "react";
import Image from "next/image";
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

const DEFAULT_AUTO_SWIPE_MS = 15_000;
const DEFAULT_PAUSE_MS = 20_000;
const SWIPE_THRESHOLD = 50;
const VELOCITY_THRESHOLD = 0.4; // px/ms — fast flick triggers swipe below distance threshold
const DRAG_CLICK_THRESHOLD = 5; // px — movement above this counts as a drag (suppresses click)
const VISIBILITY_THRESHOLD = 0.25;
const SA_FLAG_SRC = "/images/South African flag with confetti burst.png";

const CARD_W = "w-[52vw] sm:w-[40vw] lg:w-[280px] xl:w-[320px]";

/* ── SA flag section wrapper ───────────────────────────────── */

function SectionShell({
  children,
  sectionRef,
  sectionClassName,
  extraClassName,
}: {
  children: React.ReactNode;
  sectionRef?: React.Ref<HTMLDivElement>;
  sectionClassName: string;
  extraClassName?: string;
}) {
  return (
    <section
      ref={sectionRef}
      className={cn("relative w-full overflow-hidden", sectionClassName, extraClassName)}
      aria-roledescription="carousel"
      aria-label="Showroom carousel"
    >
      {/* SA flag background */}
      <div className="absolute inset-0 z-0" aria-hidden="true">
        <Image
          src={SA_FLAG_SRC}
          alt=""
          fill
          className="object-cover"
          quality={60}
          sizes="100vw"
          priority={false}
        />
      </div>
      {/* Content above the flag */}
      <div className="relative z-10">{children}</div>
    </section>
  );
}

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
  const pausedRef = useRef(false);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  /* ── Drag / pointer state ──────────────────────────────── */
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartTimeRef = useRef(0);
  const didDragRef = useRef(false);
  const coverflowRef = useRef<HTMLDivElement | null>(null);

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
    setIsPaused(true);
    if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
    pauseTimeoutRef.current = setTimeout(() => {
      pausedRef.current = false;
      setIsPaused(false);
    }, pauseOnInteractionMs);
  }, [pauseOnInteractionMs]);

  /* ── Pointer drag (unified mouse + touch) ──────────────── */

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    dragStartXRef.current = e.clientX;
    dragStartTimeRef.current = Date.now();
    didDragRef.current = false;
    setIsDragging(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }, []);

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!isDragging) return;
      const delta = e.clientX - dragStartXRef.current;
      if (Math.abs(delta) > DRAG_CLICK_THRESHOLD) {
        didDragRef.current = true;
      }
      coverflowRef.current?.style.setProperty("--drag-x", `${delta}px`);
    },
    [isDragging]
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!isDragging) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      const delta = e.clientX - dragStartXRef.current;
      const elapsed = Math.max(Date.now() - dragStartTimeRef.current, 1);
      const velocity = Math.abs(delta) / elapsed;

      setIsDragging(false);
      coverflowRef.current?.style.setProperty("--drag-x", "0px");

      const shouldSwipe = Math.abs(delta) >= SWIPE_THRESHOLD || velocity >= VELOCITY_THRESHOLD;
      if (shouldSwipe) {
        pauseAutoSwipe();
        if (delta > 0) prev();
        else next();
      }
    },
    [isDragging, next, prev, pauseAutoSwipe]
  );

  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (didDragRef.current) {
      e.preventDefault();
      e.stopPropagation();
      didDragRef.current = false;
    }
  }, []);

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

  function signedOffset(i: number): number {
    const raw = i - activeIndex;
    if (count <= 1) return 0;
    const half = count / 2;
    if (raw > half) return raw - count;
    if (raw < -half) return raw + count;
    return raw;
  }

  function cardClass(offset: number): string {
    const transitionClass =
      reducedMotion || isDragging
        ? "transition-none"
        : "transition-all duration-600 ease-[cubic-bezier(0.22,1,0.36,1)]";

    const byOffset: Record<number, string> = {
      [-3]: "translate-x-[calc(-50%-100%)] scale-[0.68] opacity-0 z-0 pointer-events-none",
      [-2]: "translate-x-[calc(-50%-100%+var(--drag-x,0px))] scale-[0.72] opacity-[0.60] z-10 lg:blur-[1px]",
      [-1]: "translate-x-[calc(-50%-55%+var(--drag-x,0px))] scale-[0.85] opacity-[0.88] z-20",
      0: "translate-x-[calc(-50%+var(--drag-x,0px))] scale-100 opacity-100 z-30 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)]",
      1: "translate-x-[calc(-50%+55%+var(--drag-x,0px))] scale-[0.85] opacity-[0.88] z-20",
      2: "translate-x-[calc(-50%+100%+var(--drag-x,0px))] scale-[0.72] opacity-[0.60] z-10 lg:blur-[1px]",
      3: "translate-x-[calc(-50%+100%)] scale-[0.68] opacity-0 z-0 pointer-events-none",
    };

    const preset = byOffset[offset] ?? byOffset[Math.sign(offset) * 3] ?? byOffset[0];

    return cn("absolute left-1/2 top-0 will-change-transform", transitionClass, preset);
  }

  /* ── Empty state ───────────────────────────────────────── */

  if (count === 0) {
    return (
      <SectionShell sectionClassName="py-8 sm:py-10 lg:py-14 xl:py-16" extraClassName={className}>
        <div className="container-page flex items-center justify-center">
          <div className={CARD_W}>
            <PosterCardShell
              href="#"
              title={emptyTitle}
              description={emptyDescription}
              location="South Africa"
              mediaUrl="/images/fallbacks/hero-shop.svg"
            />
          </div>
        </div>
      </SectionShell>
    );
  }

  /* ── Main render ───────────────────────────────────────── */

  return (
    <SectionShell
      sectionRef={containerRef}
      sectionClassName="py-6 sm:py-8 lg:py-14 xl:py-16"
      extraClassName={className}
    >
      {/* Card coverflow area */}
      <div
        ref={coverflowRef}
        className={cn(
          "relative mx-auto overflow-hidden select-none touch-pan-y",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleClickCapture}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-label="Carousel slides"
      >
        {/* Height-establishing invisible card */}
        <div className={cn("invisible mx-auto", CARD_W)} aria-hidden="true">
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
              className={cn(CARD_W, cardClass(offset))}
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
                videoMode={offset === 0 ? "ambient" : "hover"}
              />
            </div>
          );
        })}
      </div>

      {/* Navigation dots with progress indicator */}
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
              {i === activeIndex ? (
                <span className="relative h-2 w-6 overflow-hidden rounded-full bg-white/25">
                  <span
                    key={activeIndex}
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full bg-brand-green-400",
                      reducedMotion || isPaused
                        ? "w-full"
                        : `animate-[progress-fill_${autoSwipeMs}ms_linear_forwards]`
                    )}
                  />
                </span>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-white/50 transition-all duration-300 hover:bg-white/90 sm:h-2 sm:w-2" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Progress fill keyframes (injected once) */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes progress-fill{from{width:0%}to{width:100%}}`,
        }}
      />

      {/* Screen-reader live announcer */}
      {count > 1 && (
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {`Slide ${activeIndex + 1} of ${count}`}
        </div>
      )}
    </SectionShell>
  );
}

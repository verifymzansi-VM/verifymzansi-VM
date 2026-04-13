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
import { isVideoUrl } from "@/components/ui/video-card-player";
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
  /** How long image-only cards stay visible (default: 8 000 ms). */
  imageDisplayMs?: number;
  /** Safety timeout for video cards in case the video fails to load (default: 45 000 ms). */
  videoFallbackMs?: number;
  pauseOnInteractionMs?: number;
  className?: string;
  /** Fallback title when items is empty */
  emptyTitle?: string;
  /** Fallback description when items is empty */
  emptyDescription?: string;
}

/* ── Constants ─────────────────────────────────────────────── */

const IMAGE_DISPLAY_MS = 8_000;
const VIDEO_FALLBACK_MS = 45_000;
const DEFAULT_PAUSE_MS = 20_000;
const SWIPE_THRESHOLD = 50;
const VELOCITY_THRESHOLD = 0.4; // px/ms — fast flick triggers swipe below distance threshold
const FAST_FLICK_THRESHOLD = 1.2; // px/ms — fast enough to skip 2 cards
const DRAG_CLICK_THRESHOLD = 5; // px — movement above this counts as a drag (suppresses click)
const VISIBILITY_THRESHOLD = 0.25;
const SPRING_BACK_MS = 350; // duration for drag-x to spring back to 0 after release
const SA_FLAG_SRC = "/images/South African flag with confetti burst.png";

const CARD_W = "w-[52vw] sm:w-[40vw] lg:w-[280px] xl:w-[320px]";

function shouldIgnoreDragStart(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "button, [role='button'], input, textarea, select, option, label, [data-carousel-no-drag='true']"
    )
  );
}

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
  imageDisplayMs = IMAGE_DISPLAY_MS,
  videoFallbackMs = VIDEO_FALLBACK_MS,
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
  const springBackRafRef = useRef<number | null>(null);

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

  /* ── Spring-back helper (animate --drag-x → 0) ─────────── */

  const springBackDragX = useCallback(() => {
    const el = coverflowRef.current;
    if (!el) return;
    // Use CSS transition on the pseudo-property via a wrapper element trick:
    // Animate from current --drag-x to 0 over SPRING_BACK_MS.
    const current = parseFloat(getComputedStyle(el).getPropertyValue("--drag-x")) || 0;
    if (Math.abs(current) < 1) {
      el.style.setProperty("--drag-x", "0px");
      return;
    }
    const start = performance.now();
    const from = current;
    // Easing function matching cubic-bezier(0.22, 1, 0.36, 1)
    const ease = (t: number) => {
      // Approximation of cubic-bezier(0.22, 1, 0.36, 1) — strong ease-out with slight overshoot feel
      return 1 - Math.pow(1 - t, 3);
    };
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / SPRING_BACK_MS, 1);
      const value = from * (1 - ease(progress));
      el.style.setProperty("--drag-x", `${value}px`);
      if (progress < 1) {
        springBackRafRef.current = requestAnimationFrame(animate);
      } else {
        el.style.setProperty("--drag-x", "0px");
        springBackRafRef.current = null;
      }
    };
    if (springBackRafRef.current !== null) cancelAnimationFrame(springBackRafRef.current);
    springBackRafRef.current = requestAnimationFrame(animate);
  }, []);

  /* ── Pointer drag (unified mouse + touch) ──────────────── */

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    if (shouldIgnoreDragStart(e.target)) {
      return;
    }
    // Cancel any ongoing spring-back
    if (springBackRafRef.current !== null) {
      cancelAnimationFrame(springBackRafRef.current);
      springBackRafRef.current = null;
    }
    coverflowRef.current?.style.setProperty("--drag-x", "0px");
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
      const rawDelta = e.clientX - dragStartXRef.current;
      const elapsed = Math.max(Date.now() - dragStartTimeRef.current, 1);
      const absVelocity = Math.abs(rawDelta) / elapsed; // px/ms

      setIsDragging(false);

      const shouldSwipe =
        Math.abs(rawDelta) >= SWIPE_THRESHOLD || absVelocity >= VELOCITY_THRESHOLD;

      if (shouldSwipe) {
        // Determine how many cards to advance (1 or 2 based on velocity)
        const cardCount = absVelocity >= FAST_FLICK_THRESHOLD ? 2 : 1;
        const direction = rawDelta > 0 ? 1 : -1; // positive delta = swipe right = go next
        pauseAutoSwipe();
        // Animate --drag-x back to 0 smoothly while CSS transitions handle card positions
        springBackDragX();
        goTo(activeIndex + direction * cardCount);
      } else {
        // Not enough movement — spring back
        springBackDragX();
      }
    },
    [isDragging, activeIndex, pauseAutoSwipe, goTo, springBackDragX]
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

  const videoEndedRef = useRef(false);

  const handleVideoEnded = useCallback(() => {
    videoEndedRef.current = true;
    nextRef.current();
  }, []);

  const activeIsVideo = isVideoUrl(items[activeIndex]?.mediaUrl);

  useEffect(() => {
    videoEndedRef.current = false;
  }, [activeIndex]);

  useEffect(() => {
    if (count <= 1 || reducedMotion || !isVisible) return;

    // For video cards, set a safety fallback timeout only.
    // The primary advance is triggered by the video's onEnded callback.
    const delayMs = activeIsVideo ? videoFallbackMs : imageDisplayMs;

    const id = setTimeout(() => {
      if (!pausedRef.current && !videoEndedRef.current) nextRef.current();
    }, delayMs);
    return () => clearTimeout(id);
  }, [
    activeIndex,
    activeIsVideo,
    imageDisplayMs,
    videoFallbackMs,
    count,
    isVisible,
    reducedMotion,
  ]);

  /* ── Cleanup ───────────────────────────────────────────── */

  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
      if (springBackRafRef.current !== null) cancelAnimationFrame(springBackRafRef.current);
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
      [-2]: "translate-x-[calc(-50%-100%+var(--drag-x,0px))] scale-[0.72] opacity-100 z-10",
      [-1]: "translate-x-[calc(-50%-55%+var(--drag-x,0px))] scale-[0.85] opacity-100 z-20",
      0: "translate-x-[calc(-50%+var(--drag-x,0px))] scale-100 opacity-100 z-30 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)]",
      1: "translate-x-[calc(-50%+55%+var(--drag-x,0px))] scale-[0.85] opacity-100 z-20",
      2: "translate-x-[calc(-50%+100%+var(--drag-x,0px))] scale-[0.72] opacity-100 z-10",
      3: "translate-x-[calc(-50%+100%)] scale-[0.68] opacity-0 z-0 pointer-events-none",
    };

    const preset = byOffset[offset] ?? byOffset[Math.sign(offset) * 3] ?? byOffset[0];

    return cn("absolute left-1/2 top-0 will-change-transform", transitionClass, preset);
  }

  /* ── Empty state ───────────────────────────────────────── */

  if (count === 0) {
    return (
      <SectionShell
        sectionClassName="py-8 sm:py-10 lg:pt-0 lg:pb-14 xl:pt-0 xl:pb-16"
        extraClassName={className}
      >
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
      sectionClassName="py-5 sm:py-7 lg:pt-0 lg:pb-12 xl:pt-0 xl:pb-14"
      extraClassName={className}
    >
      {/* Card coverflow area */}
      <div
        ref={coverflowRef}
        className={cn(
          "relative mx-auto overflow-x-clip overflow-y-visible select-none touch-pan-y pb-6",
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
          const sideMediaFallback =
            item.posterUrl ??
            (isVideoUrl(item.mediaUrl) ? "/images/fallbacks/hero-shop.svg" : item.mediaUrl);
          const cardMediaUrl = offset === 0 ? item.mediaUrl : sideMediaFallback;

          return (
            <div
              key={item.id}
              className={cn(CARD_W, cardClass(offset))}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              {...(offset !== 0
                ? {
                    onClickCapture: (e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      pauseAutoSwipe();
                      goTo(i);
                    },
                  }
                : undefined)}
            >
              <PosterCardShell
                href={item.href}
                title={item.title}
                description={item.description}
                location={item.location}
                mediaUrl={cardMediaUrl}
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
                videoMode={offset === 0 ? "ambient" : undefined}
                onVideoEnded={offset === 0 ? handleVideoEnded : undefined}
                showPlaybackControl={offset === 0}
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
                        : activeIsVideo
                          ? "w-full"
                          : `animate-[progress-fill_${imageDisplayMs}ms_linear_forwards]`
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

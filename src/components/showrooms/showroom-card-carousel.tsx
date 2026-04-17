"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent,
} from "react";
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
const DRAG_CLICK_THRESHOLD = 12; // px — tolerate small finger jitter so taps still open the active card
const VISIBILITY_THRESHOLD = 0.25;
const DRAG_SUPPRESSION_RESET_MS = 160;
const PREVIEW_TILT_DEG = 8;
const DESKTOP_SHOWROOM_ITEM_LIMIT = 15;

const CARD_W =
  "w-[72vw] max-w-[292px] sm:w-[46vw] sm:max-w-[310px] md:w-[34vw] lg:w-[292px] lg:max-w-none xl:w-[320px] 2xl:w-[336px]";
const SECTION_SPACING =
  "pt-0 pb-1 sm:pt-0 sm:pb-3 md:pt-8 md:pb-8 lg:h-[calc(100svh-4rem)] lg:min-h-0 lg:py-0";

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
      className={cn(
        "relative w-full overflow-hidden bg-[linear-gradient(180deg,#f8f5ec_0%,#f1e8da_48%,#e8decd_100%)]",
        sectionClassName,
        extraClassName
      )}
      aria-roledescription="carousel"
      aria-label="Showroom carousel"
    >
      <div
        className="absolute inset-0 z-[1] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.88),transparent_30%),radial-gradient(circle_at_top_right,rgba(34,197,94,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.08),rgba(15,23,42,0.06)_48%,rgba(15,23,42,0.12)_100%)]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-y-0 left-0 z-[1] w-[24%] bg-gradient-to-r from-slate-950/10 via-slate-950/0 to-transparent"
        aria-hidden="true"
      />
      <div
        className="absolute inset-y-0 right-0 z-[1] w-[24%] bg-gradient-to-l from-slate-950/8 via-slate-950/0 to-transparent"
        aria-hidden="true"
      />
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
  const carouselItems = items.slice(0, DESKTOP_SHOWROOM_ITEM_LIMIT);
  const [activeIndex, setActiveIndex] = useState(0);
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  /* ── Drag / pointer state ──────────────────────────────── */
  const [isDragging, setIsDragging] = useState(false);
  const [dragDelta, setDragDelta] = useState(0);
  const [previewStep, setPreviewStep] = useState<-1 | 0 | 1>(0);
  const dragStartXRef = useRef(0);
  const dragStartTimeRef = useRef(0);
  const didDragRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activeInputModeRef = useRef<"pointer" | "mouse" | null>(null);
  const dragResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coverflowRef = useRef<HTMLDivElement | null>(null);

  const count = carouselItems.length;
  const normalizedActiveIndex = count <= 0 ? 0 : ((activeIndex % count) + count) % count;

  /* ── Navigation helpers ────────────────────────────────── */

  const goTo = useCallback(
    (index: number) => {
      if (count <= 1) return;
      setActiveIndex(((index % count) + count) % count);
    },
    [count]
  );

  const next = useCallback(() => goTo(normalizedActiveIndex + 1), [goTo, normalizedActiveIndex]);
  const prev = useCallback(() => goTo(normalizedActiveIndex - 1), [goTo, normalizedActiveIndex]);

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

  const releasePointerCapture = useCallback((element: HTMLElement | null, pointerId: number) => {
    try {
      if (element?.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    } catch {
      /* noop */
    }
  }, []);

  const queueDragReset = useCallback(() => {
    if (dragResetTimeoutRef.current) clearTimeout(dragResetTimeoutRef.current);
    dragResetTimeoutRef.current = setTimeout(() => {
      didDragRef.current = false;
      const carouselLinks = coverflowRef.current?.querySelectorAll<HTMLElement>(
        '[data-carousel-link="true"]'
      );
      carouselLinks?.forEach((link) => {
        link.style.pointerEvents = "";
      });
      dragResetTimeoutRef.current = null;
    }, DRAG_SUPPRESSION_RESET_MS);
  }, []);

  const setCarouselLinkInteractivity = useCallback((enabled: boolean) => {
    const carouselLinks = coverflowRef.current?.querySelectorAll<HTMLElement>(
      '[data-carousel-link="true"]'
    );
    carouselLinks?.forEach((link) => {
      link.style.pointerEvents = enabled ? "" : "none";
    });
  }, []);

  /* ── Pointer drag (unified mouse + touch) ──────────────── */

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-carousel-control="true"]')) {
        return;
      }

      if (dragResetTimeoutRef.current) {
        clearTimeout(dragResetTimeoutRef.current);
        dragResetTimeoutRef.current = null;
      }

      if (activeInputModeRef.current !== null) {
        return;
      }

      activePointerIdRef.current = e.pointerId;
      activeInputModeRef.current = "pointer";
      dragStartXRef.current = e.clientX;
      dragStartTimeRef.current = Date.now();
      didDragRef.current = false;
      setDragDelta(0);
      setPreviewStep(0);
      setCarouselLinkInteractivity(true);
      pauseAutoSwipe();
      setIsDragging(true);

      try {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      } catch {
        /* noop */
      }
    },
    [pauseAutoSwipe, setCarouselLinkInteractivity]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-carousel-control="true"]') || e.button !== 0) {
        return;
      }

      if (dragResetTimeoutRef.current) {
        clearTimeout(dragResetTimeoutRef.current);
        dragResetTimeoutRef.current = null;
      }

      if (activeInputModeRef.current !== null) {
        return;
      }

      activePointerIdRef.current = null;
      activeInputModeRef.current = "mouse";
      dragStartXRef.current = e.clientX;
      dragStartTimeRef.current = Date.now();
      didDragRef.current = false;
      setDragDelta(0);
      setPreviewStep(0);
      setCarouselLinkInteractivity(true);
      pauseAutoSwipe();
      setIsDragging(true);
    },
    [pauseAutoSwipe, setCarouselLinkInteractivity]
  );

  const clearActiveDrag = useCallback(
    (
      currentTarget: HTMLElement | null,
      pointerId?: number,
      options?: {
        preserveDragFlag?: boolean;
      }
    ) => {
      const activeMode = activeInputModeRef.current;
      activeInputModeRef.current = null;
      activePointerIdRef.current = null;
      if (activeMode === "pointer" && typeof pointerId === "number") {
        releasePointerCapture(currentTarget, pointerId);
      }
      setIsDragging(false);
      setDragDelta(0);
      if (!options?.preserveDragFlag) {
        didDragRef.current = false;
        setCarouselLinkInteractivity(true);
      }
    },
    [releasePointerCapture, setCarouselLinkInteractivity]
  );

  const completeDrag = useCallback(
    (clientX: number, pointerId?: number) => {
      const rawDelta = clientX - dragStartXRef.current;
      const elapsed = Math.max(Date.now() - dragStartTimeRef.current, 1);
      const absVelocity = Math.abs(rawDelta) / elapsed; // px/ms
      const shouldSuppressClick = didDragRef.current;
      const previewStepAtRelease = previewStep;

      clearActiveDrag(coverflowRef.current, pointerId, { preserveDragFlag: shouldSuppressClick });
      setPreviewStep(0);

      const shouldSwipe =
        Math.abs(rawDelta) >= SWIPE_THRESHOLD || absVelocity >= VELOCITY_THRESHOLD;

      if (shouldSwipe) {
        // Advance one card per swipe so users always move through the displayed sequence.
        const direction = previewStepAtRelease !== 0 ? previewStepAtRelease : rawDelta > 0 ? -1 : 1;
        pauseAutoSwipe();
        goTo(activeIndex + direction);
      }

      if (shouldSuppressClick) {
        queueDragReset();
      }
    },
    [clearActiveDrag, previewStep, activeIndex, pauseAutoSwipe, goTo, queueDragReset]
  );

  const cancelDrag = useCallback(
    (pointerId?: number) => {
      const shouldSuppressClick = didDragRef.current;
      clearActiveDrag(coverflowRef.current, pointerId, { preserveDragFlag: shouldSuppressClick });
      setPreviewStep(0);
      if (shouldSuppressClick) {
        queueDragReset();
      }
    },
    [clearActiveDrag, queueDragReset]
  );

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (
        activeInputModeRef.current !== "pointer" ||
        activePointerIdRef.current !== event.pointerId
      ) {
        return;
      }
      const delta = event.clientX - dragStartXRef.current;
      if (Math.abs(delta) > DRAG_CLICK_THRESHOLD) {
        if (!didDragRef.current) {
          setCarouselLinkInteractivity(false);
        }
        didDragRef.current = true;
      }
      setDragDelta(delta);
      setPreviewStep(delta >= SWIPE_THRESHOLD ? -1 : delta <= -SWIPE_THRESHOLD ? 1 : 0);
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      if (
        activeInputModeRef.current !== "pointer" ||
        activePointerIdRef.current !== event.pointerId
      ) {
        return;
      }
      completeDrag(event.clientX, event.pointerId);
    };

    const handleWindowPointerCancel = (event: PointerEvent) => {
      if (
        activeInputModeRef.current !== "pointer" ||
        activePointerIdRef.current !== event.pointerId
      ) {
        return;
      }
      cancelDrag(event.pointerId);
    };

    const handleWindowMouseMove = (event: MouseEvent) => {
      if (activeInputModeRef.current !== "mouse") return;
      const delta = event.clientX - dragStartXRef.current;
      if (Math.abs(delta) > DRAG_CLICK_THRESHOLD) {
        if (!didDragRef.current) {
          setCarouselLinkInteractivity(false);
        }
        didDragRef.current = true;
      }
      setDragDelta(delta);
      setPreviewStep(delta >= SWIPE_THRESHOLD ? -1 : delta <= -SWIPE_THRESHOLD ? 1 : 0);
    };

    const handleWindowMouseUp = (event: MouseEvent) => {
      if (activeInputModeRef.current !== "mouse") return;
      completeDrag(event.clientX);
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [cancelDrag, completeDrag, setCarouselLinkInteractivity]);

  const handlePointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (activeInputModeRef.current !== "pointer" || activePointerIdRef.current !== e.pointerId) {
        return;
      }
      cancelDrag(e.pointerId);
    },
    [cancelDrag]
  );

  const handleLostPointerCapture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (activeInputModeRef.current !== "pointer" || activePointerIdRef.current !== e.pointerId) {
        return;
      }
      const shouldSuppressClick = didDragRef.current;
      activeInputModeRef.current = null;
      activePointerIdRef.current = null;
      setIsDragging(false);
      setDragDelta(0);
      setPreviewStep(0);
      if (!shouldSuppressClick) {
        didDragRef.current = false;
        return;
      }
      queueDragReset();
    },
    [queueDragReset]
  );

  const handleClickCapture = useCallback(
    (e: React.MouseEvent) => {
      if (didDragRef.current) {
        e.preventDefault();
        e.stopPropagation();
        if (dragResetTimeoutRef.current) {
          clearTimeout(dragResetTimeoutRef.current);
          dragResetTimeoutRef.current = null;
        }
        didDragRef.current = false;
        setCarouselLinkInteractivity(true);
      }
    },
    [setCarouselLinkInteractivity]
  );

  useEffect(() => {
    const el = coverflowRef.current;
    if (!el) return;

    const handleNativeClickCapture = (event: MouseEvent) => {
      if (!didDragRef.current) return;

      event.preventDefault();
      event.stopPropagation();

      if (dragResetTimeoutRef.current) {
        clearTimeout(dragResetTimeoutRef.current);
        dragResetTimeoutRef.current = null;
      }

      didDragRef.current = false;
      setCarouselLinkInteractivity(true);
    };

    el.addEventListener("click", handleNativeClickCapture, true);
    return () => {
      el.removeEventListener("click", handleNativeClickCapture, true);
    };
  }, [setCarouselLinkInteractivity]);

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

  const displayIndex =
    count <= 1
      ? normalizedActiveIndex
      : (((normalizedActiveIndex + previewStep) % count) + count) % count;
  const activeIsVideo = isVideoUrl(carouselItems[displayIndex]?.mediaUrl);

  useEffect(() => {
    videoEndedRef.current = false;
  }, [displayIndex]);

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
    displayIndex,
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
      if (dragResetTimeoutRef.current) clearTimeout(dragResetTimeoutRef.current);
    };
  }, []);

  /* ── Render helpers ────────────────────────────────────── */

  function signedOffset(i: number): number {
    const raw = i - displayIndex;
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
        : "transition-[transform,opacity,filter,box-shadow] duration-700 ease-out";

    const byOffset: Record<number, string> = {
      [-3]: "hidden lg:block translate-x-[calc(-50%-106%)] translate-y-4 scale-[0.54] opacity-32 saturate-[0.72] blur-[1.4px] z-0 pointer-events-none",
      [-2]: "hidden md:block translate-x-[calc(-50%-72%)] translate-y-2 scale-[0.7] opacity-48 saturate-[0.84] blur-[0.8px] z-10 pointer-events-none",
      [-1]: "translate-x-[calc(-50%-39%)] lg:translate-y-0 scale-[0.9] lg:scale-[0.85] opacity-84 saturate-[0.92] z-20",
      0: "translate-x-[-50%] lg:-translate-y-0 scale-100 lg:scale-[1.02] opacity-100 z-40 shadow-[0_42px_116px_-52px_rgba(15,23,42,0.72)]",
      1: "translate-x-[calc(-50%+39%)] lg:translate-y-0 scale-[0.9] lg:scale-[0.85] opacity-84 saturate-[0.92] z-20",
      2: "hidden md:block translate-x-[calc(-50%+72%)] translate-y-2 scale-[0.7] opacity-48 saturate-[0.84] blur-[0.8px] z-10 pointer-events-none",
      3: "hidden lg:block translate-x-[calc(-50%+106%)] translate-y-4 scale-[0.54] opacity-32 saturate-[0.72] blur-[1.4px] z-0 pointer-events-none",
    };

    const preset = byOffset[offset] ?? byOffset[Math.sign(offset) * 3] ?? byOffset[0];

    return cn("absolute left-1/2 top-0 will-change-transform", transitionClass, preset);
  }

  function cardStyle(offset: number): CSSProperties | undefined {
    if (!isDragging || offset !== 0 || previewStep !== 0 || Math.abs(dragDelta) < 1) {
      return reducedMotion || isDragging
        ? undefined
        : { transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" };
    }

    const progress = Math.max(-1, Math.min(1, dragDelta / SWIPE_THRESHOLD));
    return {
      transform: `translateX(-50%) rotateY(${progress * PREVIEW_TILT_DEG}deg) scale(${1 - Math.abs(progress) * 0.02})`,
    };
  }

  /* ── Empty state ───────────────────────────────────────── */

  if (count === 0) {
    return (
      <SectionShell sectionClassName={SECTION_SPACING} extraClassName={className}>
        <div className="container-page flex items-center justify-center lg:h-full">
          <div className={CARD_W}>
            <PosterCardShell
              href="#"
              title={emptyTitle}
              description={emptyDescription}
              location="South Africa"
              mediaUrl="/images/fallbacks/hero-shop.svg"
              cardVariant="hero"
              mediaControlVariant="hero"
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
      sectionClassName={SECTION_SPACING}
      extraClassName={className}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-[12%] z-[2] hidden h-28 lg:block bg-[radial-gradient(circle,rgba(255,255,255,0.42)_0%,rgba(255,255,255,0.08)_45%,transparent_72%)] blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-[12%] z-[2] hidden h-24 lg:block bg-[radial-gradient(circle,rgba(15,23,42,0.32)_0%,rgba(15,23,42,0.08)_40%,transparent_72%)] blur-3xl"
        aria-hidden="true"
      />
      {/* Card coverflow area */}
      <div
        ref={coverflowRef}
        className={cn(
          "relative mx-auto max-w-[1680px] overflow-x-clip overflow-y-visible select-none touch-pan-y pb-0 lg:flex lg:h-full lg:items-center lg:pb-0",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        onPointerDown={handlePointerDown}
        onMouseDown={handleMouseDown}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onDragStartCapture={(e) => {
          e.preventDefault();
        }}
        onClickCapture={handleClickCapture}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-label="Carousel slides"
      >
        {/* Height-establishing invisible card */}
        <div className={cn("invisible mx-auto lg:translate-y-2", CARD_W)} aria-hidden="true">
          <PosterCardShell
            href="#"
            title="Verified Marketplace Listing Placeholder"
            description="Placeholder description"
            location="South Africa"
            eyebrow="R 0"
            mediaUrl="/images/fallbacks/hero-shop.svg"
            cardVariant="hero"
            mediaControlVariant="hero"
          />
        </div>

        {/* Absolutely positioned coverflow cards */}
        {carouselItems.map((item, i) => {
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
              style={cardStyle(offset)}
              data-showroom-layer={offset === 0 ? "active" : "stack"}
              data-slot-offset={offset}
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
                makeEntireCardClickable={offset === 0}
                cardVariant="hero"
                mediaControlVariant={offset === 0 ? "hero" : "default"}
                fitStrategy="cover"
              />
            </div>
          );
        })}
      </div>

      {/* Navigation dots with progress indicator */}
      {count > 1 && (
        <div
          className="absolute inset-x-0 bottom-2 z-20 flex items-center justify-center gap-1.5 lg:bottom-4"
          role="group"
          aria-label="Slide controls"
        >
          {carouselItems.map((_, i) => (
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
              {i === displayIndex ? (
                <span className="relative h-2 w-6 overflow-hidden rounded-full bg-white/25">
                  <span
                    key={displayIndex}
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full bg-brand-green-400",
                      reducedMotion || isPaused
                        ? "w-full"
                        : activeIsVideo
                          ? "w-full"
                          : "animate-progress-fill"
                    )}
                    style={
                      reducedMotion || isPaused || activeIsVideo
                        ? undefined
                        : ({ "--progress-fill-duration": `${imageDisplayMs}ms` } as CSSProperties)
                    }
                  />
                </span>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-white/50 transition-all duration-300 hover:bg-white/90 sm:h-2 sm:w-2" />
              )}
            </button>
          ))}
        </div>
      )}
      {/* Screen-reader live announcer */}
      {count > 1 && (
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {`Slide ${displayIndex + 1} of ${count}`}
        </div>
      )}
    </SectionShell>
  );
}

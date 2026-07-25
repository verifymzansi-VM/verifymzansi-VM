"use client";

import Image from "next/image";
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
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  fallbackMediaUrl?: string | null;
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
  /** Area-branded artwork for the empty-state card (default: homepage artwork). */
  emptyMediaUrl?: string;
  /** Optional decorative photo background for market pages. */
  background?: ShowroomDecorativeBackground;
}

export type ShowroomBackgroundOverlayPreset = "market" | "business" | "tourism";

export interface ShowroomDecorativeBackground {
  src: string;
  mobileSrc?: string;
  objectPosition?: string;
  mobileObjectPosition?: string;
  overlayPreset?: ShowroomBackgroundOverlayPreset;
  blurPx?: number;
  dimOpacity?: number;
}

/* ── Constants ─────────────────────────────────────────────── */

const IMAGE_DISPLAY_MS = 8_000;
const VIDEO_FALLBACK_MS = 45_000;
const DEFAULT_PAUSE_MS = 20_000;
const SWIPE_THRESHOLD = 50;
const VELOCITY_THRESHOLD = 0.4; // px/ms — fast flick triggers swipe below distance threshold
const FLICK_DISTANCE_THRESHOLD = 32;
const DRAG_CLICK_THRESHOLD = 12; // px — tolerate small finger jitter so taps still open the active card
const DRAG_PROGRESS_DISTANCE = 150;
const VISIBILITY_THRESHOLD = 0.25;
const DRAG_SUPPRESSION_RESET_MS = 160;
const PREVIEW_TILT_DEG = 9;
const DESKTOP_SHOWROOM_ITEM_LIMIT = 15;
const TYPE_FALLBACK_MEDIA: Record<CarouselItem["type"], string> = {
  listing: "/images/fallbacks/hero-listing.svg",
  business: "/images/fallbacks/hero-business.svg",
  promotion: "/images/fallbacks/hero-shop.svg",
};

const CARD_W = "showroom-card-frame";
const SECTION_SPACING =
  "pt-0 pb-8 sm:pt-0 sm:pb-10 md:pt-4 md:pb-12 lg:min-h-[clamp(31rem,64vh,42rem)] lg:py-10";
const SECTION_SURFACE =
  "bg-[linear-gradient(180deg,#faf8f3_0%,#f3eee4_52%,#ece5d6_100%)] dark:bg-[linear-gradient(180deg,#0c0f14_0%,#0a0d12_52%,#080a0f_100%)]";
const MAX_VISIBLE_DOTS = 7;

function getBackgroundOverlayClasses(preset: ShowroomBackgroundOverlayPreset = "market") {
  switch (preset) {
    case "business":
      return {
        wash: "bg-[linear-gradient(180deg,rgba(246,246,244,0.24)_0%,rgba(229,234,240,0.12)_38%,rgba(15,23,42,0.18)_100%)]",
        accent:
          "bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.08),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(148,163,184,0.06),transparent_32%)]",
        edgeLeft: "bg-gradient-to-r from-slate-950/10 via-slate-950/2 to-transparent",
        edgeRight: "bg-gradient-to-l from-slate-950/8 via-slate-950/2 to-transparent",
        topGlow:
          "bg-[radial-gradient(circle,rgba(255,255,255,0.32)_0%,rgba(219,234,254,0.12)_45%,transparent_72%)]",
        bottomGlow:
          "bg-[radial-gradient(circle,rgba(15,23,42,0.42)_0%,rgba(30,41,59,0.12)_40%,transparent_72%)]",
      };
    case "tourism":
      return {
        wash: "bg-[linear-gradient(180deg,rgba(238,246,255,0.2)_0%,rgba(234,239,244,0.08)_32%,rgba(15,23,42,0.16)_100%)]",
        accent:
          "bg-[radial-gradient(circle_at_top_right,rgba(125,211,252,0.08),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.07),transparent_32%)]",
        edgeLeft: "bg-gradient-to-r from-slate-950/8 via-slate-950/2 to-transparent",
        edgeRight: "bg-gradient-to-l from-slate-950/6 via-slate-950/1 to-transparent",
        topGlow:
          "bg-[radial-gradient(circle,rgba(219,234,254,0.34)_0%,rgba(255,255,255,0.08)_45%,transparent_72%)]",
        bottomGlow:
          "bg-[radial-gradient(circle,rgba(15,23,42,0.32)_0%,rgba(15,23,42,0.08)_40%,transparent_72%)]",
      };
    case "market":
    default:
      return {
        wash: "bg-[linear-gradient(180deg,rgba(250,246,239,0.24)_0%,rgba(241,232,218,0.12)_38%,rgba(15,23,42,0.18)_100%)]",
        accent:
          "bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.07),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(245,158,11,0.05),transparent_30%)]",
        edgeLeft: "bg-gradient-to-r from-slate-950/8 via-slate-950/2 to-transparent",
        edgeRight: "bg-gradient-to-l from-slate-950/7 via-slate-950/2 to-transparent",
        topGlow:
          "bg-[radial-gradient(circle,rgba(255,255,255,0.36)_0%,rgba(255,255,255,0.08)_45%,transparent_72%)]",
        bottomGlow:
          "bg-[radial-gradient(circle,rgba(15,23,42,0.38)_0%,rgba(15,23,42,0.1)_40%,transparent_72%)]",
      };
  }
}

function getFallbackMediaUrl(item: CarouselItem): string {
  return item.fallbackMediaUrl ?? TYPE_FALLBACK_MEDIA[item.type];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

/* ── Visible progress + arrow controls ─────────────────────── */

interface ShowroomProgressDotsProps {
  count: number;
  activeIndex: number;
  onSelect: (index: number) => void;
  /** Duration of the active slide — drives the fill animation on the active dot. */
  activeDurationMs: number;
  /** Fill animation only runs for timed image slides while autoplay is live. */
  fillActive: boolean;
  isPaused: boolean;
}

function getVisibleDotRange(count: number, activeIndex: number) {
  if (count <= MAX_VISIBLE_DOTS) return { start: 0, end: count - 1 };
  const start = Math.max(
    0,
    Math.min(activeIndex - Math.floor(MAX_VISIBLE_DOTS / 2), count - MAX_VISIBLE_DOTS)
  );
  return { start, end: start + MAX_VISIBLE_DOTS - 1 };
}

function ShowroomProgressDots({
  count,
  activeIndex,
  onSelect,
  activeDurationMs,
  fillActive,
  isPaused,
}: ShowroomProgressDotsProps) {
  if (count <= 1) return null;
  const { start, end } = getVisibleDotRange(count, activeIndex);
  const indexes = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <div
      className="relative z-20 flex items-center justify-center gap-1 pb-1 pt-3 sm:pt-4"
      aria-label="Showroom slide position"
      data-testid="showroom-progress"
    >
      {indexes.map((index) => {
        const isActive = index === activeIndex;
        return (
          <button
            key={index}
            type="button"
            aria-current={isActive ? "true" : undefined}
            aria-label={`Go to slide ${index + 1} of ${count}`}
            data-carousel-control="true"
            data-showroom-dot={isActive ? "active" : "inactive"}
            onClick={() => onSelect(index)}
            className="group/dot flex min-h-[32px] min-w-[32px] items-center justify-center rounded-full p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/40 dark:focus-visible:ring-white/40"
          >
            <span
              className={cn(
                "relative block h-1.5 overflow-hidden rounded-full transition-all duration-300",
                isActive
                  ? "w-6 bg-slate-900/25 dark:bg-white/25"
                  : "w-1.5 bg-slate-900/30 group-hover/dot:bg-slate-900/50 dark:bg-white/30 dark:group-hover/dot:bg-white/50"
              )}
            >
              {isActive && fillActive ? (
                <span
                  key={activeIndex}
                  className="animate-progress-fill absolute inset-y-0 left-0 rounded-full bg-slate-900/80 dark:bg-white/90"
                  style={
                    {
                      "--progress-fill-duration": `${activeDurationMs}ms`,
                      animationPlayState: isPaused ? "paused" : "running",
                    } as CSSProperties
                  }
                />
              ) : isActive ? (
                <span className="absolute inset-0 rounded-full bg-slate-900/80 dark:bg-white/90" />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ShowroomArrowButton({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}) {
  const isPrev = direction === "prev";
  return (
    <button
      type="button"
      data-carousel-control="true"
      onClick={onClick}
      aria-label={isPrev ? "Previous slide" : "Next slide"}
      className={cn(
        "absolute top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full",
        "border border-slate-900/10 bg-white/75 text-slate-800 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.35)] backdrop-blur-md",
        "transition-all duration-200 hover:scale-105 hover:bg-white active:scale-95",
        "dark:border-white/15 dark:bg-slate-950/60 dark:text-white dark:hover:bg-slate-950/80",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/40 dark:focus-visible:ring-white/40",
        "lg:flex",
        isPrev ? "left-4 xl:left-10" : "right-4 xl:right-10"
      )}
    >
      {isPrev ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
    </button>
  );
}

/* ── SA flag section wrapper ───────────────────────────────── */

function SectionShell({
  children,
  sectionRef,
  sectionClassName,
  extraClassName,
  background,
}: {
  children: React.ReactNode;
  sectionRef?: React.Ref<HTMLDivElement>;
  sectionClassName: string;
  extraClassName?: string;
  background?: ShowroomDecorativeBackground;
}) {
  const hasBackground = Boolean(background?.src);
  const overlayClasses = getBackgroundOverlayClasses(background?.overlayPreset);
  const backgroundFilter = `blur(${background?.blurPx ?? 18}px) saturate(0.82) brightness(0.78)`;
  const backgroundSrc = background?.src ?? "";
  const mobileBackgroundSrc = background?.mobileSrc ?? backgroundSrc;
  const desktopPosition = background?.objectPosition ?? "center";
  const mobilePosition = background?.mobileObjectPosition ?? desktopPosition;
  const usesSameResponsiveBackground = backgroundSrc === mobileBackgroundSrc;

  return (
    <section
      ref={sectionRef}
      className={cn(
        "relative w-full overflow-hidden",
        SECTION_SURFACE,
        sectionClassName,
        extraClassName
      )}
      aria-roledescription="carousel"
      aria-label="Showroom carousel"
    >
      {hasBackground ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
          aria-hidden="true"
        >
          {usesSameResponsiveBackground ? (
            <Image
              src={backgroundSrc}
              alt=""
              fill
              sizes="100vw"
              priority
              className="object-cover scale-[1.12] md:scale-[1.08] lg:scale-[1.04]"
              style={{ objectPosition: mobilePosition, filter: backgroundFilter }}
              data-showroom-background="shared"
            />
          ) : (
            <>
              <Image
                src={backgroundSrc}
                alt=""
                fill
                sizes="100vw"
                priority
                className={cn("hidden object-cover md:block", "scale-[1.08] lg:scale-[1.04]")}
                style={{ objectPosition: desktopPosition, filter: backgroundFilter }}
                data-showroom-background="desktop"
              />
              <Image
                src={mobileBackgroundSrc}
                alt=""
                fill
                sizes="100vw"
                priority
                className="object-cover md:hidden scale-[1.12]"
                style={{ objectPosition: mobilePosition, filter: backgroundFilter }}
                data-showroom-background="mobile"
              />
            </>
          )}
          <div
            className="absolute inset-0 bg-slate-950"
            style={{ opacity: background?.dimOpacity ?? 0.44 }}
          />
        </div>
      ) : null}
      <div
        className={cn(
          "absolute inset-0 z-[1]",
          hasBackground
            ? overlayClasses.wash
            : "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.88),transparent_30%),radial-gradient(circle_at_top_right,rgba(34,197,94,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.08),rgba(15,23,42,0.06)_48%,rgba(15,23,42,0.12)_100%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.06),transparent_32%),radial-gradient(circle_at_top_right,rgba(34,197,94,0.08),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(0,0,0,0.12)_48%,rgba(0,0,0,0.28)_100%)]"
        )}
        aria-hidden="true"
      />
      {hasBackground ? (
        <div className={cn("absolute inset-0 z-[1]", overlayClasses.accent)} aria-hidden="true" />
      ) : null}
      <div
        className={cn(
          "absolute inset-y-0 left-0 z-[1] w-[24%]",
          hasBackground
            ? overlayClasses.edgeLeft
            : "bg-gradient-to-r from-slate-950/10 via-slate-950/0 to-transparent"
        )}
        aria-hidden="true"
      />
      <div
        className={cn(
          "absolute inset-y-0 right-0 z-[1] w-[24%]",
          hasBackground
            ? overlayClasses.edgeRight
            : "bg-gradient-to-l from-slate-950/8 via-slate-950/0 to-transparent"
        )}
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
  emptyDescription = "Explore business profiles, listings, tourism, and events.",
  emptyMediaUrl = "/images/fallbacks/hero-home.svg",
  background,
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

      const startedOnCarouselLink = Boolean(target?.closest('[data-carousel-link="true"]'));

      if (e.pointerType === "mouse" && !startedOnCarouselLink) {
        e.preventDefault();
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
      setCarouselLinkInteractivity(true);
      pauseAutoSwipe();
      setIsDragging(true);

      if (e.pointerType !== "mouse") {
        try {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        } catch {
          /* noop */
        }
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

      const startedOnCarouselLink = Boolean(target?.closest('[data-carousel-link="true"]'));
      if (!startedOnCarouselLink) {
        e.preventDefault();
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

      clearActiveDrag(coverflowRef.current, pointerId, { preserveDragFlag: shouldSuppressClick });

      const distance = Math.abs(rawDelta);
      const shouldSwipe =
        distance >= SWIPE_THRESHOLD ||
        (distance >= FLICK_DISTANCE_THRESHOLD && absVelocity >= VELOCITY_THRESHOLD);

      if (shouldSwipe) {
        // Advance one card per swipe so users always move through the displayed sequence.
        const direction = rawDelta > 0 ? -1 : 1;
        pauseAutoSwipe();
        goTo(activeIndex + direction);
      }

      if (shouldSuppressClick) {
        queueDragReset();
      }
    },
    [clearActiveDrag, activeIndex, pauseAutoSwipe, goTo, queueDragReset]
  );

  const cancelDrag = useCallback(
    (pointerId?: number) => {
      const shouldSuppressClick = didDragRef.current;
      clearActiveDrag(coverflowRef.current, pointerId, { preserveDragFlag: shouldSuppressClick });
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

  const displayIndex = normalizedActiveIndex;
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
      [-3]: "hidden lg:block translate-x-[calc(-50%-106%)] translate-y-4 scale-[0.55] opacity-100 saturate-[0.86] blur-[0.35px] z-0 pointer-events-none",
      [-2]: "hidden md:block translate-x-[calc(-50%-72%)] translate-y-2 scale-[0.72] opacity-100 saturate-[0.92] blur-[0.2px] z-10 pointer-events-none",
      [-1]: "translate-x-[calc(-50%-23%)] md:translate-x-[calc(-50%-39%)] lg:-translate-y-2 scale-[0.91] lg:scale-[0.86] opacity-100 saturate-[0.98] z-20",
      0: "translate-x-[-50%] lg:-translate-y-3 scale-100 lg:scale-[1.025] opacity-100 z-40 shadow-[0_50px_130px_-54px_rgba(15,23,42,0.8)]",
      1: "translate-x-[calc(-50%+23%)] md:translate-x-[calc(-50%+39%)] lg:-translate-y-2 scale-[0.91] lg:scale-[0.86] opacity-100 saturate-[0.98] z-20",
      2: "hidden md:block translate-x-[calc(-50%+72%)] translate-y-2 scale-[0.72] opacity-100 saturate-[0.92] blur-[0.2px] z-10 pointer-events-none",
      3: "hidden lg:block translate-x-[calc(-50%+106%)] translate-y-4 scale-[0.55] opacity-100 saturate-[0.86] blur-[0.35px] z-0 pointer-events-none",
    };

    const preset = byOffset[offset] ?? byOffset[Math.sign(offset) * 3] ?? byOffset[0];

    return cn("absolute left-1/2 top-0 will-change-transform", transitionClass, preset);
  }

  function cardStyle(offset: number): CSSProperties | undefined {
    if (reducedMotion) return undefined;

    if (!isDragging || Math.abs(dragDelta) < 1) {
      return {
        transitionTimingFunction: "cubic-bezier(0.18, 0.9, 0.22, 1)",
      };
    }

    const progress = clamp(dragDelta / DRAG_PROGRESS_DISTANCE, -1, 1);
    const virtualOffset = clamp(offset + progress, -3, 3);
    const depth = Math.min(Math.abs(virtualOffset), 3);
    const sign = virtualOffset === 0 ? 0 : virtualOffset > 0 ? 1 : -1;
    const floorDepth = Math.floor(depth);
    const depthProgress = depth - floorDepth;
    const isMobileViewport =
      typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
    const xStops = [0, isMobileViewport ? 23 : 39, 72, 106];
    const yStops = [-12, -8, 8, 16];
    const scaleStops = [1.045, 0.875, 0.72, 0.55];
    const opacityStops = [1, 1, 1, 1];
    const blurStops = [0, 0, 0.55, 1.05];
    const saturationStops = [1.02, 0.95, 0.86, 0.76];
    const currentStop = Math.min(floorDepth, xStops.length - 1);
    const nextStop = Math.min(currentStop + 1, xStops.length - 1);
    const x = lerp(xStops[currentStop], xStops[nextStop], depthProgress) * sign;
    const y = lerp(yStops[currentStop], yStops[nextStop], depthProgress);
    const scale = lerp(scaleStops[currentStop], scaleStops[nextStop], depthProgress);
    const opacity = lerp(opacityStops[currentStop], opacityStops[nextStop], depthProgress);
    const blur = lerp(blurStops[currentStop], blurStops[nextStop], depthProgress);
    const saturation = lerp(saturationStops[currentStop], saturationStops[nextStop], depthProgress);
    const activeTilt = offset === 0 ? progress * PREVIEW_TILT_DEG : 0;
    const sideTilt = offset === 0 ? 0 : -sign * lerp(1.5, 5.5, clamp(depth, 0, 1));
    const liftShadow = 1 - clamp(depth / 2, 0, 1);
    const shadowAlpha = lerp(0.16, 0.82, liftShadow);

    return {
      transform: `translateX(calc(-50% + ${x}%)) translateY(${y}px) rotateY(${activeTilt + sideTilt}deg) scale(${scale})`,
      opacity,
      filter: `saturate(${saturation}) blur(${blur}px)`,
      zIndex: Math.round(50 - depth * 12),
      boxShadow: `0 ${Math.round(44 + liftShadow * 18)}px ${Math.round(
        92 + liftShadow * 48
      )}px -56px rgba(15,23,42,${shadowAlpha})`,
    };
  }

  /* ── Empty state ───────────────────────────────────────── */

  if (count === 0) {
    return (
      <SectionShell
        sectionClassName={SECTION_SPACING}
        extraClassName={className}
        background={background}
      >
        <div className="container-page flex items-center justify-center lg:h-full">
          <div className="flex w-full max-w-5xl flex-col items-center gap-6 py-6 sm:gap-8 lg:flex-row lg:justify-center lg:gap-14">
            {/* Area-branded artwork card */}
            <div className={cn(CARD_W, "shrink-0")}>
              <PosterCardShell
                href="#"
                title={emptyTitle}
                description={emptyDescription}
                location="South Africa"
                mediaUrl={emptyMediaUrl}
                cardVariant="hero"
                mediaControlVariant="hero"
              />
            </div>
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
      background={background}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-[12%] z-[2] hidden h-28 lg:block blur-3xl",
          background
            ? getBackgroundOverlayClasses(background.overlayPreset).topGlow
            : "bg-[radial-gradient(circle,rgba(255,255,255,0.42)_0%,rgba(255,255,255,0.08)_45%,transparent_72%)]"
        )}
        aria-hidden="true"
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-[12%] z-[2] hidden h-24 lg:block blur-3xl",
          background
            ? getBackgroundOverlayClasses(background.overlayPreset).bottomGlow
            : "bg-[radial-gradient(circle,rgba(15,23,42,0.32)_0%,rgba(15,23,42,0.08)_40%,transparent_72%)]"
        )}
        aria-hidden="true"
      />
      {/* Card coverflow area */}
      <div
        ref={coverflowRef}
        className={cn(
          "relative mx-auto max-w-[1680px] overflow-x-clip overflow-y-visible select-none touch-pan-y pb-2 [perspective:1200px] sm:pb-3 md:pb-4 lg:flex lg:min-h-[clamp(28rem,60vh,39rem)] lg:items-center lg:pb-1",
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
        <div className={cn("invisible mx-auto lg:-translate-y-1", CARD_W)} aria-hidden="true">
          <PosterCardShell
            href="#"
            title="Carousel sizing card"
            description="Hidden layout sizing element"
            location=""
            eyebrow=""
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
            (isVideoUrl(item.mediaUrl) ? getFallbackMediaUrl(item) : item.mediaUrl);
          const activeVideoNeedsArtwork =
            offset === 0 && isVideoUrl(item.mediaUrl) && !item.posterUrl;
          const cardMediaUrl =
            offset === 0 && !activeVideoNeedsArtwork ? item.mediaUrl : sideMediaFallback;

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
                mediaFallbackUrl={getFallbackMediaUrl(item)}
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
                fitStrategy="contain"
              />
            </div>
          );
        })}
      </div>

      {/* Screen-reader live announcer */}
      {count > 1 && (
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {`Slide ${displayIndex + 1} of ${count}`}
        </div>
      )}

      {/* Desktop arrow controls */}
      {count > 1 && (
        <>
          <ShowroomArrowButton
            direction="prev"
            onClick={() => {
              pauseAutoSwipe();
              prev();
            }}
          />
          <ShowroomArrowButton
            direction="next"
            onClick={() => {
              pauseAutoSwipe();
              next();
            }}
          />
        </>
      )}

      {/* Visible progress / state */}
      <ShowroomProgressDots
        count={count}
        activeIndex={displayIndex}
        onSelect={(index) => {
          pauseAutoSwipe();
          goTo(index);
        }}
        activeDurationMs={imageDisplayMs}
        fillActive={!reducedMotion && isVisible && !activeIsVideo && count > 1}
        isPaused={isPaused}
      />
    </SectionShell>
  );
}

"use client";

import {
  Children,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

const DEFAULT_INTERVAL_MS = 4500;
const DEFAULT_PAUSE_MS = 7000;

interface AutoScrollRailProps {
  children: ReactNode;
  className?: string;
  itemClassName?: string;
  intervalMs?: number;
  pauseAfterInteractionMs?: number;
  ariaLabel?: string;
  showEdgeFades?: boolean;
  flushEdges?: boolean;
}

interface AutoScrollRailContextValue {
  activeIndex: number;
  isDragging: boolean;
}

const AutoScrollRailContext = createContext<AutoScrollRailContextValue | null>(null);
const AutoScrollRailItemIndexContext = createContext<number | null>(null);

export function useAutoScrollRailItemState() {
  const rail = useContext(AutoScrollRailContext);
  const itemIndex = useContext(AutoScrollRailItemIndexContext);

  if (!rail || itemIndex == null) {
    return {
      activeIndex: 0,
      itemIndex: 0,
      isActive: true,
      isRailDragging: false,
    };
  }

  return {
    activeIndex: rail.activeIndex,
    itemIndex,
    isActive: rail.activeIndex === itemIndex,
    isRailDragging: rail.isDragging,
  };
}

function getScrollStep(container: HTMLDivElement): number {
  const firstChild = container.firstElementChild as HTMLElement | null;
  if (!firstChild) return container.clientWidth;

  const styles = window.getComputedStyle(container);
  const gapValue = styles.columnGap || styles.gap || "0";
  const gap = Number.parseFloat(gapValue) || 0;

  return firstChild.getBoundingClientRect().width + gap;
}

function isNearEnd(container: HTMLDivElement, threshold = 8): boolean {
  const maxScrollLeft = container.scrollWidth - container.clientWidth;
  return maxScrollLeft <= threshold || container.scrollLeft >= maxScrollLeft - threshold;
}

function clampIndex(index: number, itemCount: number): number {
  if (itemCount <= 1) return 0;
  return Math.max(0, Math.min(index, itemCount - 1));
}

function getCenteredIndex(container: HTMLDivElement, itemCount: number): number {
  const step = getScrollStep(container);
  if (step <= 0) return 0;
  return clampIndex(Math.round(container.scrollLeft / step), itemCount);
}

export function AutoScrollRail({
  children,
  className,
  itemClassName,
  intervalMs = DEFAULT_INTERVAL_MS,
  pauseAfterInteractionMs = DEFAULT_PAUSE_MS,
  ariaLabel,
  showEdgeFades = true,
  flushEdges = false,
}: AutoScrollRailProps) {
  const items = useMemo(() => Children.toArray(children), [children]);
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const [isVisible, setIsVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const generatedLabel = useId();
  const railLabel = ariaLabel || `horizontal-rail-${generatedLabel}`;
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragging, setDragging] = useState(false);

  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeftStr = useRef(0);
  const dragMoved = useRef(false);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  const pauseAndResume = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }
    pauseTimeoutRef.current = setTimeout(() => {
      pausedRef.current = false;
      setPaused(false);
    }, pauseAfterInteractionMs);
  }, [pauseAfterInteractionMs]);

  const updateActiveIndex = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    setActiveIndex(getCenteredIndex(container, items.length));
  }, [items.length]);

  const scheduleSettle = useCallback(() => {
    if (settleTimeoutRef.current) {
      clearTimeout(settleTimeoutRef.current);
    }
    settleTimeoutRef.current = setTimeout(() => {
      updateActiveIndex();
      if (!isDragging.current) {
        setDragging(false);
      }
    }, 120);
  }, [updateActiveIndex]);

  // Detect hover-capable (desktop) devices — auto-scroll only runs on desktop.
  // Touch-only devices rely on native swipe via snap-scroll.
  useEffect(() => {
    const mql = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting && entry.intersectionRatio > 0.25);
      },
      {
        threshold: [0.25, 0.5],
      }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scheduleUpdate = () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      scrollRafRef.current = requestAnimationFrame(() => {
        updateActiveIndex();
        scrollRafRef.current = null;
      });
    };

    const handleScroll = () => {
      scheduleUpdate();
      scheduleSettle();
    };

    scheduleUpdate();
    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", scheduleUpdate);
      if (settleTimeoutRef.current) {
        clearTimeout(settleTimeoutRef.current);
        settleTimeoutRef.current = null;
      }
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [scheduleSettle, updateActiveIndex]);

  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
      if (settleTimeoutRef.current) {
        clearTimeout(settleTimeoutRef.current);
      }
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (items.length <= 1 || reducedMotion || paused || !isVisible || !canHover) return;

    const id = window.setInterval(() => {
      if (pausedRef.current) return;

      const step = getScrollStep(container);
      if (step <= 0) return;

      if (isNearEnd(container)) {
        container.scrollTo({ left: 0, behavior: "smooth" });
        return;
      }

      container.scrollTo({
        left: Math.min(
          container.scrollLeft + step,
          Math.max(0, container.scrollWidth - container.clientWidth)
        ),
        behavior: "smooth",
      });
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [canHover, intervalMs, isVisible, items.length, paused, reducedMotion]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
        pauseAndResume();
      }
    };

    const handleTouchStart = () => {
      setDragging(true);
      pauseAndResume();
    };

    const handleTouchEnd = () => {
      scheduleSettle();
    };

    container.addEventListener("pointerdown", pauseAndResume, { passive: true });
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    container.addEventListener("wheel", pauseAndResume, { passive: true });
    container.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("pointerdown", pauseAndResume);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
      container.removeEventListener("wheel", pauseAndResume);
      container.removeEventListener("keydown", handleKeyDown);
    };
  }, [pauseAndResume, scheduleSettle]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;

    const container = containerRef.current;
    if (!container) return;

    isDragging.current = true;
    setDragging(true);
    startX.current = e.pageX - container.offsetLeft;
    scrollLeftStr.current = container.scrollLeft;
    dragMoved.current = false;

    container.style.scrollBehavior = "auto";
    container.style.scrollSnapType = "none";
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    e.preventDefault();

    const container = containerRef.current;
    if (!container) return;

    const x = e.pageX - container.offsetLeft;
    const diff = x - startX.current;

    if (Math.abs(diff) > 5) {
      dragMoved.current = true;
    }

    container.scrollLeft = scrollLeftStr.current - diff * 2;
  };

  const handlePointerUpOrLeave = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    setDragging(false);

    const container = containerRef.current;
    if (!container) return;

    container.style.scrollBehavior = "";
    container.style.scrollSnapType = "";
    pauseAndResume();
    scheduleSettle();
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    if (dragMoved.current) {
      e.stopPropagation();
      e.preventDefault();
      // Reset drag flag shortly after to allow subsequent clicks
      setTimeout(() => (dragMoved.current = false), 0);
    }
  };

  const railContextValue = useMemo(
    () => ({
      activeIndex,
      isDragging: dragging,
    }),
    [activeIndex, dragging]
  );

  return (
    <AutoScrollRailContext.Provider value={railContextValue}>
      <div className="relative">
        <div
          ref={containerRef}
          aria-label={railLabel}
          className={cn(
            "flex overflow-x-auto snap-x snap-mandatory gap-3 pb-3 scrollbar-hide sm:gap-4 lg:gap-5 select-none",
            flushEdges ? "mx-0 px-0" : "-mx-2 px-2 sm:-mx-1 sm:px-1 lg:-mx-2 lg:px-2",
            className
          )}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrLeave}
          onPointerLeave={handlePointerUpOrLeave}
          onClickCapture={handleClickCapture}
        >
          {items.map((item, index) => (
            <AutoScrollRailItemIndexContext.Provider key={index} value={index}>
              <div
                className={cn("snap-start shrink-0", itemClassName)}
                data-rail-item-index={index}
                data-rail-item-active={activeIndex === index ? "true" : "false"}
              >
                {item}
              </div>
            </AutoScrollRailItemIndexContext.Provider>
          ))}
        </div>
        {showEdgeFades ? (
          <>
            <div
              className="pointer-events-none absolute left-0 top-0 h-full w-10 bg-gradient-to-r from-white/95 via-white/60 to-transparent dark:from-slate-950/95 dark:via-slate-950/60"
              aria-hidden="true"
              data-testid="auto-scroll-rail-fade-left"
            />
            <div
              className="pointer-events-none absolute right-0 top-0 h-full w-10 bg-gradient-to-l from-white/95 via-white/60 to-transparent dark:from-slate-950/95 dark:via-slate-950/60"
              aria-hidden="true"
              data-testid="auto-scroll-rail-fade-right"
            />
          </>
        ) : null}
      </div>
    </AutoScrollRailContext.Provider>
  );
}

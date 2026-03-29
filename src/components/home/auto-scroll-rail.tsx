"use client";

import { Children, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
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

export function AutoScrollRail({
  children,
  className,
  itemClassName,
  intervalMs = DEFAULT_INTERVAL_MS,
  pauseAfterInteractionMs = DEFAULT_PAUSE_MS,
  ariaLabel,
}: AutoScrollRailProps) {
  const items = useMemo(() => Children.toArray(children), [children]);
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const [isVisible, setIsVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const generatedLabel = useId();
  const railLabel = ariaLabel || `horizontal-rail-${generatedLabel}`;

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
    return () => {
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (items.length <= 1 || reducedMotion || paused || !isVisible) return;

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
  }, [intervalMs, isVisible, items.length, paused, reducedMotion]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pauseAndResume = () => {
      pausedRef.current = true;
      setPaused(true);
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
      pauseTimeoutRef.current = setTimeout(() => {
        pausedRef.current = false;
        setPaused(false);
      }, pauseAfterInteractionMs);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
        pauseAndResume();
      }
    };

    container.addEventListener("pointerdown", pauseAndResume, { passive: true });
    container.addEventListener("touchstart", pauseAndResume, { passive: true });
    container.addEventListener("wheel", pauseAndResume, { passive: true });
    container.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("pointerdown", pauseAndResume);
      container.removeEventListener("touchstart", pauseAndResume);
      container.removeEventListener("wheel", pauseAndResume);
      container.removeEventListener("keydown", handleKeyDown);
    };
  }, [pauseAfterInteractionMs]);

  return (
    <div
      ref={containerRef}
      aria-label={railLabel}
      className={cn(
        "flex overflow-x-auto snap-x snap-mandatory gap-3 pb-2 scrollbar-hide -mx-3 px-3 sm:-mx-0 sm:px-0 sm:gap-4",
        className
      )}
      tabIndex={0}
    >
      {items.map((item, index) => (
        <div key={index} className={cn("snap-start shrink-0", itemClassName)}>
          {item}
        </div>
      ))}
    </div>
  );
}

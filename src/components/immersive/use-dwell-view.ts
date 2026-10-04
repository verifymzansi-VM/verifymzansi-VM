"use client";

import { useEffect, useRef } from "react";
import type { FeedSlide } from "@/lib/feed/types";
import { trackContentView } from "@/lib/views/content-views";

/** A post counts as viewed after two continuous seconds on screen in the foreground. */
const VIEW_DWELL_MS = 2000;

/**
 * Records one page view for the post on screen (both viewers). Moving through
 * the post's own photos and videos never counts it again; a hidden tab pauses
 * the countdown.
 */
export function useDwellView(
  slide: FeedSlide | undefined,
  surface: string | null,
  onCounted: (slide: FeedSlide) => void
) {
  // The latest callback, so a new one never restarts the countdown.
  const counted = useRef(onCounted);
  useEffect(() => {
    counted.current = onCounted;
  });
  useEffect(() => {
    if (!slide || !surface) return;
    let timer: number | null = null;
    let cancelled = false;
    const arm = () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        void trackContentView({
          type: slide.targetType,
          id: slide.id,
          source: "page",
          surface,
        }).then((wasCounted) => {
          if (wasCounted && !cancelled) counted.current(slide);
        });
        document.removeEventListener("visibilitychange", arm);
      }, VIEW_DWELL_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [slide, surface]);
}

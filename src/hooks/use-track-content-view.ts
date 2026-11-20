"use client";

import { useEffect, useRef } from "react";
import type { ContentTargetType } from "@/lib/engagement";
import { trackContentViewAfterDwell } from "@/lib/views/content-views";
import { useClassicSuppressed } from "@/components/immersive/classic-suppression";

/**
 * Opening a post's own page is a view once the page has been visible for two
 * seconds in the foreground (a hidden tab pauses the countdown). It shares the
 * window with video views, so opening the page and watching its video counts
 * once.
 */
export function useTrackContentView(
  targetId: string,
  targetType: ContentTargetType,
  enabled = true,
  onRecorded?: () => void
) {
  const isSuppressed = useClassicSuppressed();
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  useEffect(() => {
    // The desktop viewer counts this post itself, after two seconds on screen.
    if (!enabled || isSuppressed()) return;
    return trackContentViewAfterDwell(
      { type: targetType, id: targetId, source: "page", surface: "detail" },
      () => onRecordedRef.current?.()
    );
  }, [enabled, isSuppressed, targetId, targetType]);
}

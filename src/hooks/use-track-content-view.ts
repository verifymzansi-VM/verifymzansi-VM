"use client";

import { useEffect, useRef } from "react";
import type { ContentTargetType } from "@/lib/engagement";
import { trackContentView } from "@/lib/views/content-views";

/**
 * Opening a post's own page is a view. It shares the 30-minute window with
 * video views, so opening the page and watching its video counts once.
 */
export function useTrackContentView(
  targetId: string,
  targetType: ContentTargetType,
  enabled = true,
  onRecorded?: () => void
) {
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void trackContentView({
      type: targetType,
      id: targetId,
      source: "page",
      surface: "detail",
    }).then((counted) => {
      if (counted && active) onRecordedRef.current?.();
    });
    return () => {
      active = false;
    };
  }, [enabled, targetId, targetType]);
}

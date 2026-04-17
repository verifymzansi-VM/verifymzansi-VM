"use client";

import { useEffect } from "react";
import type { ContentTargetType } from "@/lib/engagement";

export function useTrackContentView(
  targetId: string,
  targetType: ContentTargetType,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const controller = new AbortController();

    void fetch("/api/engagement/view", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetId,
        targetType,
      }),
      signal: controller.signal,
    }).catch(() => {
      // Non-blocking analytics-style request: ignore failures.
    });

    return () => controller.abort();
  }, [enabled, targetId, targetType]);
}

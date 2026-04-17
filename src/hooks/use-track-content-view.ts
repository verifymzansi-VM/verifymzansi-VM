"use client";

import { useEffect } from "react";
import type { ContentTargetType } from "@/lib/engagement";

export function useTrackContentView(
  targetId: string,
  targetType: ContentTargetType,
  enabled = true,
  onRecorded?: () => void
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
    })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as { recorded?: boolean } | null;
        if (payload?.recorded) {
          onRecorded?.();
        }
      })
      .catch(() => {
        // Non-blocking analytics-style request: ignore failures.
      });

    return () => controller.abort();
  }, [enabled, onRecorded, targetId, targetType]);
}

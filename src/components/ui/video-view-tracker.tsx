"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type { ContentTargetType } from "@/lib/engagement";

/** Public content links also identify cards shared by the showroom and feeds. */
function targetFromHref(href?: string) {
  const match = href?.match(
    /^\/(listing|mzansi-business|tourism-events)\/([0-9a-f-]{36})(?:[/?#]|$)/i
  );
  if (!match) return null;
  const types: Record<string, ContentTargetType> = {
    listing: "listing",
    "mzansi-business": "business",
    "tourism-events": "promotion",
  };
  return { targetType: types[match[1].toLowerCase()], targetId: match[2] };
}

export function VideoViewTracker({
  children,
  href,
  targetId,
  targetType,
  enabled = true,
  onRecorded,
}: {
  children: ReactNode;
  href?: string;
  targetId?: string;
  targetType?: ContentTargetType;
  enabled?: boolean;
  onRecorded?: () => void;
}) {
  const target = targetFromHref(href);
  const id = targetId ?? target?.targetId;
  const type = targetType ?? target?.targetType;
  const container = useRef<HTMLSpanElement>(null);
  const active = useRef(new WeakMap<HTMLVideoElement, string>());

  const record = useCallback(
    (video: HTMLVideoElement) => {
      if (!enabled || !id || !type || document.visibilityState === "hidden") return;
      const source = `${id}:${type}:${video.currentSrc || video.src}`;
      if (active.current.get(video) === source) return;
      active.current.set(video, source);
      void fetch("/api/engagement/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: id, targetType: type, playbackId: crypto.randomUUID() }),
        keepalive: true,
      })
        .then(async (response) => {
          if (!response.ok) return;
          const payload = await response.json();
          if (payload?.recorded) {
            onRecorded?.();
            window.dispatchEvent(
              new CustomEvent("vmz:content-view-recorded", {
                detail: { targetId: id, targetType: type },
              })
            );
          }
        })
        .catch(() => {
          // View tracking must never interrupt playback.
        });
    },
    [enabled, id, type, onRecorded]
  );

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        active.current = new WeakMap();
      } else {
        container.current?.querySelectorAll("video").forEach((video) => {
          if (!video.paused && !video.ended && video.readyState >= 3) record(video);
        });
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [record]);

  return (
    <span
      ref={container}
      className="contents"
      onPlayingCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) record(event.target);
      }}
      onPauseCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) active.current.delete(event.target);
      }}
      onEndedCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) active.current.delete(event.target);
      }}
    >
      {children}
    </span>
  );
}

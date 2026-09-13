"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { readVideoSession, writeVideoSession } from "@/lib/video-view-session";
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
  const samples = useRef(new WeakMap<HTMLVideoElement, { time: number; wall: number }>());

  const sample = (video: HTMLVideoElement, accumulate: boolean) => {
    if (!enabled || !id || !type) return;
    const now = Date.now();
    const previous = samples.current.get(video);
    samples.current.set(video, { time: video.currentTime, wall: now });
    if (document.visibilityState === "hidden" || video.seeking) return;
    const key = `vmz:video-session:${type}:${id}`;
    const session = readVideoSession(key, now);
    const elapsed = previous ? (now - previous.wall) / 1000 : 0;
    const progress = previous ? (video.currentTime - previous.time) / (video.playbackRate || 1) : 0;
    // Only credit advancing playback, bounded by real foreground time. Seeking,
    // buffering, and a missing stream of timeupdate events do not earn watch time.
    if (
      accumulate &&
      previous &&
      elapsed > 0 &&
      elapsed <= 5 &&
      progress > 0 &&
      progress <= elapsed + 0.5
    ) {
      session.watched += Math.min(elapsed, progress);
    }
    session.lastActivity = now;
    const threshold =
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(30, video.duration * 0.9)
        : 30;
    const qualifies =
      !session.submitted && session.watched >= threshold && now >= session.retryAfter;
    if (qualifies) session.submitted = true;
    writeVideoSession(key, session);
    if (!qualifies) return;

    void fetch("/api/engagement/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: id, targetType: type, playbackId: session.playbackId }),
      keepalive: true,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("View request failed");
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
        // Retry the SAME event after a transient failure, never a fresh view ID.
        const current = readVideoSession(key, Date.now());
        if (current.playbackId === session.playbackId) {
          current.submitted = false;
          current.retryAfter = Date.now() + 10000;
          writeVideoSession(key, current);
        }
      });
  };

  useEffect(() => {
    const resetSamples = () => {
      samples.current = new WeakMap();
    };
    document.addEventListener("visibilitychange", resetSamples);
    return () => document.removeEventListener("visibilitychange", resetSamples);
  }, []);

  return (
    <span
      className="contents"
      onPlayingCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) sample(event.target, false);
      }}
      onTimeUpdateCapture={(event) => {
        if (event.target instanceof HTMLVideoElement && !event.target.paused)
          sample(event.target, true);
      }}
      onSeekingCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) samples.current.delete(event.target);
      }}
      onWaitingCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) samples.current.delete(event.target);
      }}
      onPauseCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) samples.current.delete(event.target);
      }}
      onEndedCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) samples.current.delete(event.target);
      }}
    >
      {children}
    </span>
  );
}

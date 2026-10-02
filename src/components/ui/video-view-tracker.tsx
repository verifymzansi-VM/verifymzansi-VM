"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { ContentTargetType } from "@/lib/engagement";
import { trackContentView, VIEW_WINDOW_MS } from "@/lib/views/content-views";

/** MRC/IAB video standard: half the player on screen for 2 continuous seconds. */
const VIEW_CONTINUOUS_SECONDS = 2;
const VIEW_MIN_VISIBLE_RATIO = 0.5;
/** Engaged view: 30 seconds, or 90% of a shorter video. */
const ENGAGED_SECONDS = 30;
const ENGAGED_SHARE = 0.9;
/** A video shorter than the view threshold counts once 97% of it has played. */
const SHORT_VIDEO_SHARE = 0.97;

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

interface PlaybackState {
  /** Wall-clock and media time of the last sample. */
  wall: number;
  time: number;
  /** Seconds of uninterrupted, on-screen playback. */
  continuous: number;
  /** Seconds watched in total on this element. */
  watched: number;
  viewSent: boolean;
  engagedSent: boolean;
  /** When this element's view was sent; a looping video counts again after the window. */
  sentAt: number;
}

/**
 * Counts video views for every player inside it. Wrap any card, gallery or
 * full-screen viewer that plays a post's video. Pass `targetType` whenever the
 * link is ambiguous: /tourism-events/<id> opens tourism businesses as well as
 * events, so it cannot be inferred from the link alone.
 */
export function VideoViewTracker({
  children,
  href,
  targetId,
  targetType,
  surface,
  enabled = true,
  onRecorded,
}: {
  children: ReactNode;
  href?: string;
  targetId?: string;
  targetType?: ContentTargetType;
  surface?: string;
  enabled?: boolean;
  onRecorded?: () => void;
}) {
  const inferred = targetFromHref(href);
  const id = targetId ?? inferred?.targetId;
  const type = targetType ?? inferred?.targetType;
  const states = useRef(new WeakMap<HTMLVideoElement, PlaybackState>());
  const visibility = useRef(new WeakMap<HTMLVideoElement, number>());
  const observers = useRef(new Map<HTMLVideoElement, IntersectionObserver>());
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  const observe = (video: HTMLVideoElement) => {
    if (observers.current.has(video) || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        visibility.current.set(video, entry.isIntersecting ? entry.intersectionRatio : 0),
      { threshold: [0, 0.25, VIEW_MIN_VISIBLE_RATIO, 0.75, 1] }
    );
    observer.observe(video);
    observers.current.set(video, observer);
  };

  const isOnScreen = (video: HTMLVideoElement) => {
    // Without IntersectionObserver support we cannot measure, so trust playback.
    if (typeof IntersectionObserver === "undefined") return true;
    const ratio = visibility.current.get(video);
    return ratio === undefined || ratio >= VIEW_MIN_VISIBLE_RATIO;
  };

  const report = (engaged: boolean) => {
    if (!id || !type) return;
    void trackContentView({ type, id, source: "video", surface, engaged }).then((counted) => {
      if (counted) onRecordedRef.current?.();
    });
  };

  const sample = (video: HTMLVideoElement, accumulate: boolean) => {
    if (!enabled || !id || !type) return;
    const now = Date.now();
    const previous = states.current.get(video);
    const state: PlaybackState = previous ?? {
      wall: now,
      time: video.currentTime,
      continuous: 0,
      watched: 0,
      viewSent: false,
      engagedSent: false,
      sentAt: 0,
    };
    if (state.viewSent && now - state.sentAt >= VIEW_WINDOW_MS) {
      state.viewSent = false;
      state.engagedSent = false;
      state.continuous = 0;
      state.watched = 0;
    }
    const elapsed = previous ? (now - previous.wall) / 1000 : 0;
    const progress = previous ? (video.currentTime - previous.time) / (video.playbackRate || 1) : 0;
    state.wall = now;
    state.time = video.currentTime;
    states.current.set(video, state);

    const counts =
      accumulate &&
      previous !== undefined &&
      document.visibilityState !== "hidden" &&
      !video.seeking &&
      isOnScreen(video) &&
      elapsed > 0 &&
      elapsed <= 5 &&
      progress > 0 &&
      progress <= elapsed + 0.5;

    if (!counts) {
      // Off screen, hidden tab, seeking or stalled: the 2 seconds start again.
      if (accumulate) state.continuous = 0;
      return;
    }

    const credited = Math.min(elapsed, progress);
    state.continuous += credited;
    state.watched += credited;

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    const viewThreshold =
      duration !== null && duration < VIEW_CONTINUOUS_SECONDS
        ? duration * SHORT_VIDEO_SHARE
        : VIEW_CONTINUOUS_SECONDS;
    const engagedThreshold =
      duration !== null ? Math.min(ENGAGED_SECONDS, duration * ENGAGED_SHARE) : ENGAGED_SECONDS;

    if (!state.viewSent && state.continuous >= viewThreshold) {
      state.viewSent = true;
      state.sentAt = now;
      report(false);
    }
    if (!state.engagedSent && state.watched >= engagedThreshold) {
      state.engagedSent = true;
      report(true);
    }
  };

  const restart = (video: HTMLVideoElement) => {
    const state = states.current.get(video);
    if (!state) return;
    state.continuous = 0;
    state.wall = Date.now();
    state.time = video.currentTime;
  };

  useEffect(() => {
    const current = observers.current;
    const resetAll = () => {
      states.current = new WeakMap();
    };
    document.addEventListener("visibilitychange", resetAll);
    return () => {
      document.removeEventListener("visibilitychange", resetAll);
      current.forEach((observer) => observer.disconnect());
      current.clear();
    };
  }, []);

  return (
    <span
      className="contents"
      onPlayingCapture={(event) => {
        if (!(event.target instanceof HTMLVideoElement)) return;
        observe(event.target);
        // Pause, stall and seek already restart the 2 seconds; resuming keeps it.
        if (!states.current.has(event.target)) sample(event.target, false);
      }}
      onTimeUpdateCapture={(event) => {
        if (event.target instanceof HTMLVideoElement && !event.target.paused)
          sample(event.target, true);
      }}
      onSeekingCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) restart(event.target);
      }}
      onWaitingCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) restart(event.target);
      }}
      onPauseCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) restart(event.target);
      }}
      onEndedCapture={(event) => {
        if (!(event.target instanceof HTMLVideoElement)) return;
        const video = event.target;
        sample(video, true);
        // A replay is a fresh play (the server still counts one per 30 minutes).
        states.current.delete(video);
      }}
    >
      {children}
    </span>
  );
}

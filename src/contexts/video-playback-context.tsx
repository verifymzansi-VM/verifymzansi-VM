"use client";

import { createContext, useCallback, useContext, useMemo, useRef } from "react";

/**
 * Global video playback manager — ensures only **one** video plays at a time,
 * similar to how Facebook / YouTube feeds work.
 *
 * Each video reports its intersection ratio. The manager picks the most-visible
 * video and plays it, pausing all others. Hover interactions can temporarily
 * claim priority via `requestPriority` / `releasePriority`.
 */

interface VideoPlaybackManager {
  /** Register a video element for managed playback. */
  register(el: HTMLVideoElement): void;
  /** Unregister a video element (cleanup). */
  unregister(el: HTMLVideoElement): void;
  /** Report updated intersection visibility for a video. */
  updateVisibility(el: HTMLVideoElement, ratio: number): void;
  /** Claim exclusive playback priority (e.g. on hover). */
  requestPriority(el: HTMLVideoElement): void;
  /** Release exclusive playback priority. */
  releasePriority(el: HTMLVideoElement): void;
}

const VideoPlaybackContext = createContext<VideoPlaybackManager | null>(null);

export function useVideoPlaybackManager(): VideoPlaybackManager {
  const ctx = useContext(VideoPlaybackContext);
  if (!ctx) {
    throw new Error("useVideoPlaybackManager must be used within <VideoPlaybackProvider>");
  }
  return ctx;
}

export function VideoPlaybackProvider({ children }: { children: React.ReactNode }) {
  // Map of registered videos → their current intersection ratio
  const videosRef = useRef(new Map<HTMLVideoElement, number>());
  // Element currently holding exclusive priority (hover)
  const priorityRef = useRef<HTMLVideoElement | null>(null);
  // Currently playing element
  const activeRef = useRef<HTMLVideoElement | null>(null);
  // Debounce timer for arbitration
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arbitrate = useCallback(() => {
    const videos = videosRef.current;
    const priority = priorityRef.current;

    // If a priority element exists and is registered, it wins
    let winner: HTMLVideoElement | null = null;

    if (priority && videos.has(priority)) {
      winner = priority;
    } else {
      // Pick the video with the highest intersection ratio
      let bestRatio = 0;
      for (const [el, ratio] of videos) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          winner = el;
        }
      }
      // Require minimum 25% visibility
      if (bestRatio < 0.25) {
        winner = null;
      }
    }

    // If the winner hasn't changed, nothing to do
    if (winner === activeRef.current) return;

    // Pause the previous active video
    if (activeRef.current && activeRef.current !== winner) {
      activeRef.current.pause();
    }

    activeRef.current = winner;

    // Play the winner
    if (winner && winner.paused && winner.src) {
      winner.play().catch(() => {
        /* autoplay may be blocked */
      });
    }

    // Pause all non-winners that are still playing
    for (const [el] of videos) {
      if (el !== winner && !el.paused) {
        el.pause();
      }
    }
  }, []);

  const scheduleArbitration = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(arbitrate, 80);
  }, [arbitrate]);

  const register = useCallback((el: HTMLVideoElement) => {
    videosRef.current.set(el, 0);
  }, []);

  const unregister = useCallback(
    (el: HTMLVideoElement) => {
      videosRef.current.delete(el);
      if (activeRef.current === el) {
        activeRef.current = null;
      }
      if (priorityRef.current === el) {
        priorityRef.current = null;
      }
      scheduleArbitration();
    },
    [scheduleArbitration]
  );

  const updateVisibility = useCallback(
    (el: HTMLVideoElement, ratio: number) => {
      if (!videosRef.current.has(el)) return;
      videosRef.current.set(el, ratio);
      scheduleArbitration();
    },
    [scheduleArbitration]
  );

  const requestPriority = useCallback(
    (el: HTMLVideoElement) => {
      priorityRef.current = el;
      // Arbitrate immediately for responsive hover feedback
      arbitrate();
    },
    [arbitrate]
  );

  const releasePriority = useCallback(
    (el: HTMLVideoElement) => {
      if (priorityRef.current === el) {
        priorityRef.current = null;
      }
      scheduleArbitration();
    },
    [scheduleArbitration]
  );

  const manager = useMemo<VideoPlaybackManager>(
    () => ({
      register,
      unregister,
      updateVisibility,
      requestPriority,
      releasePriority,
    }),
    [register, unregister, updateVisibility, requestPriority, releasePriority]
  );

  return <VideoPlaybackContext.Provider value={manager}>{children}</VideoPlaybackContext.Provider>;
}

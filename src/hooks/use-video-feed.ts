import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { useDataSaver } from "./use-data-saver";
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";

/**
 * Hook for mobile feed-style video playback (Facebook / YouTube behaviour).
 *
 * - Video `src` is NOT set until the element is ≥ 25 % visible (zero network
 *   requests on initial load).
 * - The most-visible video auto-plays muted; scrolling past pauses it.
 * - Tap-to-toggle: tapping pauses the active video, tapping again resumes.
 * - When the user manually pauses, auto-play is suppressed until:
 *   (a) the user taps play again, or
 *   (b) the video scrolls > 75 % out of view (resets for next scroll-in).
 * - Play claims exclusive priority in the global manager, pausing all other
 *   videos (including showroom carousels).
 * - Respects `prefers-reduced-motion: reduce`.
 *
 * @param videoSrc The video URL. Pass `undefined` when the media is not a video.
 * @param isPlaybackEligible When false, the video stays paused even if visible.
 */
export function useVideoFeed(videoSrc?: string, isPlaybackEligible = true) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reducedMotion = useReducedMotion();
  const dataSaver = useDataSaver();
  // Autoplay stays off when the user prefers reduced motion or data saving;
  // the card falls back to a poster with a manual play button.
  const autoplayBlocked = reducedMotion || dataSaver;
  const manager = useVideoPlaybackManager();

  // Track whether the user explicitly paused via tap
  const [isPausedByUser, setIsPausedByUser] = useState(false);
  const isPausedByUserRef = useRef(false);

  // Track playing state for the tap indicator
  const [isPlaying, setIsPlaying] = useState(false);

  // Keep ref in sync with state for use in IntersectionObserver callback
  useEffect(() => {
    isPausedByUserRef.current = isPausedByUser;
  }, [isPausedByUser]);

  // Sync isPlaying with the video element's actual state
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, []);

  // Register with manager + IntersectionObserver for lazy-load and visibility reporting
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSrc) return;

    manager.register(el);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Lazily assign src the first time the element is visible
          if (!el.src) {
            el.src = videoSrc;
          }

          // Reset user-pause when element scrolls back into view from being mostly hidden
          // (handled below in the !isIntersecting branch)

          if (!autoplayBlocked && isPlaybackEligible && !isPausedByUserRef.current) {
            manager.updateVisibility(el, entry.intersectionRatio);
          } else {
            // User paused or autoplay blocked — don't compete for playback
            el.pause();
            manager.updateVisibility(el, 0);
          }
        } else {
          el.pause();
          manager.updateVisibility(el, 0);

          // Reset user-pause when scrolled > 75% out of view so auto-play
          // can resume when the card scrolls back in
          if (entry.intersectionRatio < 0.25 && isPausedByUserRef.current) {
            isPausedByUserRef.current = false;
            setIsPausedByUser(false);
          }
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      manager.unregister(el);
    };
  }, [videoSrc, autoplayBlocked, manager, isPlaybackEligible]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || isPlaybackEligible) return;
    el.pause();
    manager.updateVisibility(el, 0);
  }, [isPlaybackEligible, manager]);

  // Tap-to-toggle playback
  const togglePlayback = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;

    if (el.paused) {
      // Resume / start playback — claim exclusive priority
      if (!el.src && videoSrc) {
        el.src = videoSrc;
      }
      isPausedByUserRef.current = false;
      setIsPausedByUser(false);
      manager.requestPriority(el);
    } else {
      // Pause playback
      el.pause();
      isPausedByUserRef.current = true;
      setIsPausedByUser(true);
      manager.releasePriority(el);
      manager.updateVisibility(el, 0);
    }
  }, [videoSrc, manager]);

  return { videoRef, isPlaying, isPausedByUser, togglePlayback, reducedMotion: autoplayBlocked };
}

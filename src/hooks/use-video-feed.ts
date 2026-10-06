import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { useDataSaver } from "./use-data-saver";
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";
import { useAutoplayPolicy } from "@/contexts/autoplay-policy-context";
import { useVideoAutoplayStore } from "@/stores/video-autoplay-store";

/**
 * Hook for mobile feed-style video playback (Facebook / YouTube behaviour).
 *
 * - Video `src` is NOT set until the element is ≥ 25 % visible (zero network
 *   requests on initial load).
 * - While the shared autoplay intent is on, the most-visible video auto-plays
 *   muted; scrolling past pauses it.
 * - Tap-to-toggle sets the shared intent (like the global mute button):
 *   tapping play turns autoplay on for every card, tapping pause stops every
 *   card and keeps them all paused until the user taps play again.
 * - Play claims exclusive priority in the global manager, pausing all other
 *   videos (including showroom carousels).
 * - Respects `prefers-reduced-motion: reduce`, `Save-Data`, and the page-level
 *   autoplay policy (`useAutoplayPolicy`, e.g. autoplay disabled on mobile)
 *   until the user presses play.
 *
 * @param videoSrc The video URL. Pass `undefined` when the media is not a video.
 * @param isPlaybackEligible Whether this card may autoplay. Manual play always works.
 */
export function useVideoFeed(videoSrc?: string, isPlaybackEligible = true) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reducedMotion = useReducedMotion();
  const dataSaver = useDataSaver();
  const { disableAutoplay } = useAutoplayPolicy();
  const autoplayEnabled = useVideoAutoplayStore((s) => s.autoplayEnabled);
  // Autoplay stays off when the user prefers reduced motion or data saving.
  // The page's mobile no-autoplay policy holds only until the user presses
  // play; after that their choice decides. Rendered output uses the policy
  // alone so the first client render matches the server HTML.
  const policyBlocked = reducedMotion || dataSaver || disableAutoplay;
  const autoplayBlocked = reducedMotion || dataSaver || (disableAutoplay && !autoplayEnabled);
  const manager = useVideoPlaybackManager();
  const setAutoplayEnabled = useVideoAutoplayStore((s) => s.setAutoplayEnabled);
  const manuallyPlayingRef = useRef(false);
  const playbackEligibleRef = useRef(isPlaybackEligible);
  const visibilityRef = useRef(0);
  useEffect(() => {
    playbackEligibleRef.current = isPlaybackEligible;
  }, [isPlaybackEligible]);

  // Read inside the IntersectionObserver callback without re-observing:
  // re-registering would pause the card the user just tapped and drop its
  // playback priority. The effect below applies changes to these values.
  const autoplayEnabledRef = useRef(autoplayEnabled);
  const autoplayBlockedRef = useRef(autoplayBlocked);
  useEffect(() => {
    autoplayEnabledRef.current = autoplayEnabled;
    autoplayBlockedRef.current = autoplayBlocked;
  }, [autoplayEnabled, autoplayBlocked]);

  // Track playing state for the tap indicator
  const [isPlaying, setIsPlaying] = useState(false);

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
        visibilityRef.current = entry.isIntersecting ? entry.intersectionRatio : 0;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.25) {
          // Lazily assign src the first time the element is visible
          const canAutoplay =
            !autoplayBlockedRef.current &&
            playbackEligibleRef.current &&
            autoplayEnabledRef.current;
          if (canAutoplay && el.getAttribute("src") !== videoSrc) {
            el.src = videoSrc;
          }

          if (manuallyPlayingRef.current) {
            // Keep explicit playback priority as a visible rail card moves.
            // Re-reporting autoplay eligibility here would cancel the user's play.
            return;
          }
          if (canAutoplay) {
            manager.updateVisibility(el, entry.intersectionRatio);
          } else {
            // Autoplay paused by the user or blocked — don't compete for playback
            el.pause();
            manager.updateVisibility(el, 0);
          }
        } else {
          manuallyPlayingRef.current = false;
          el.pause();
          manager.releasePriority(el);
          manager.updateVisibility(el, 0);
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      manager.unregister(el);
    };
  }, [videoSrc, manager]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!autoplayEnabled) {
      // A pause on any card stops every card, including one started by hand.
      manuallyPlayingRef.current = false;
      el.pause();
      manager.releasePriority(el);
      manager.updateVisibility(el, 0);
      return;
    }
    if (manuallyPlayingRef.current) return;
    if (isPlaybackEligible && !autoplayBlocked) {
      if (visibilityRef.current >= 0.25 && videoSrc && el.getAttribute("src") !== videoSrc) {
        el.src = videoSrc;
      }
      manager.updateVisibility(el, visibilityRef.current);
    } else {
      el.pause();
      manager.releasePriority(el);
      manager.updateVisibility(el, 0);
    }
  }, [isPlaybackEligible, autoplayBlocked, autoplayEnabled, manager, videoSrc]);

  // Tap-to-toggle playback
  const togglePlayback = useCallback(() => {
    const el = videoRef.current;
    if (!el || !videoSrc) return;

    if (el.paused) {
      // Resume / start playback — claim exclusive priority
      if (el.getAttribute("src") !== videoSrc) {
        el.src = videoSrc;
      }
      manuallyPlayingRef.current = true;
      autoplayEnabledRef.current = true;
      manager.requestPriority(el);
      setAutoplayEnabled(true);
    } else {
      // Pause playback
      el.pause();
      manuallyPlayingRef.current = false;
      autoplayEnabledRef.current = false;
      manager.releasePriority(el);
      manager.updateVisibility(el, 0);
      setAutoplayEnabled(false);
    }
  }, [videoSrc, manager, setAutoplayEnabled]);

  return { videoRef, isPlaying, togglePlayback, reducedMotion: policyBlocked };
}

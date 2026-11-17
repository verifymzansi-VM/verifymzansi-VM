import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { useDataSaver } from "./use-data-saver";
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";
import { useAutoplayPolicy } from "@/contexts/autoplay-policy-context";

/**
 * Hook for the inline "Preview" on touch-screen video cards.
 *
 * - A tap on the card opens the post; the video only plays when the visitor
 *   presses the card's Preview button. Feed cards never start by themselves,
 *   so they spend no mobile data until asked (only the active showroom card
 *   may play by itself).
 * - The video `src` is not set until Preview is pressed (zero network requests
 *   for idle cards).
 * - Preview claims exclusive priority in the global manager, pausing every
 *   other video (including showroom carousels). It is a one-off: it does not
 *   change the shared autoplay intent used by the showroom.
 * - The preview stops when the card scrolls out of view (below 25 % visible)
 *   or stops being the focused card of its rail, and does not resume by itself.
 *
 * @param videoSrc The video URL. Pass `undefined` when the media is not a video.
 * @param isPreviewEligible False once the card is no longer the focused card in
 *   its rail; a running preview then stops.
 */
export function useVideoFeed(videoSrc?: string, isPreviewEligible = true) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reducedMotion = useReducedMotion();
  const dataSaver = useDataSaver();
  const { disableAutoplay } = useAutoplayPolicy();
  // Cards keep their idle look (for example the sound button) where the page
  // and the visitor's settings would have allowed automatic playback before.
  const quietByPreference = reducedMotion || dataSaver || disableAutoplay;
  const manager = useVideoPlaybackManager();
  const previewingRef = useRef(false);

  // Track playing state for the Preview / Pause controls
  const [isPlaying, setIsPlaying] = useState(false);

  // Sync isPlaying with the video element's actual state
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      previewingRef.current = false;
      setIsPlaying(false);
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, []);

  const stopPreview = useCallback(
    (el: HTMLVideoElement) => {
      previewingRef.current = false;
      if (!el.paused) el.pause();
      manager.releasePriority(el);
      manager.updateVisibility(el, 0);
    },
    [manager]
  );

  // Register with the manager. Feed cards never compete for automatic
  // playback; visibility only ends a running preview.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSrc) return;

    manager.register(el);

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        if (visible && previewingRef.current) return;
        stopPreview(el);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      manager.unregister(el);
    };
  }, [videoSrc, manager, stopPreview]);

  // A card that loses focus in its rail stops its preview.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || isPreviewEligible || !previewingRef.current) return;
    stopPreview(el);
  }, [isPreviewEligible, stopPreview]);

  // Preview button: start or stop the inline preview of this card only.
  const togglePlayback = useCallback(() => {
    const el = videoRef.current;
    if (!el || !videoSrc) return;

    if (el.paused) {
      if (el.getAttribute("src") !== videoSrc) {
        el.src = videoSrc;
      }
      previewingRef.current = true;
      manager.requestPriority(el);
    } else {
      stopPreview(el);
    }
  }, [videoSrc, manager, stopPreview]);

  return { videoRef, isPlaying, togglePlayback, reducedMotion: quietByPreference };
}

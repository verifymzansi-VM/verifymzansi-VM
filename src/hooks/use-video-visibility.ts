import { useEffect, useRef } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";

/**
 * Hook that lazily loads and plays a video only when it scrolls into view.
 *
 * - The video `src` is NOT set until the element is ≥ 25 % visible, so pages
 *   with many video cards make **zero** video network requests on initial load.
 * - Playback is **managed globally** — only the most-visible video plays at any
 *   given time (Facebook / YouTube-style single-video autoplay).
 * - Respects `prefers-reduced-motion: reduce` — the video `src` is still lazy-
 *   loaded (so poster-frame extraction works), but auto-play is skipped.
 *
 * @param videoSrc  The video URL. Pass `undefined` when the media is not a video.
 * @param shouldAutoplay When false, the video still lazy-loads but will not auto-play.
 * @returns `{ videoRef, reducedMotion }` — attach `videoRef` to the `<video>` element.
 */
export function useVideoVisibility(videoSrc?: string, shouldAutoplay = true) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reducedMotion = useReducedMotion();
  const manager = useVideoPlaybackManager();

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

          if (!reducedMotion && shouldAutoplay) {
            // Report visibility to the global manager — it decides which video plays
            manager.updateVisibility(el, entry.intersectionRatio);
          } else {
            el.pause();
            manager.updateVisibility(el, 0);
          }
        } else {
          el.pause();
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
  }, [videoSrc, reducedMotion, shouldAutoplay, manager]);

  return { videoRef, reducedMotion };
}

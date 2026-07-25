import { useEffect, useRef } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { useDataSaver } from "./use-data-saver";
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";

/**
 * Hook that lazily loads and plays a video only when it scrolls into view.
 *
 * - The video `src` is NOT set until the element is ≥ 15 % visible, so pages
 *   with many video cards make **zero** video network requests on initial load.
 * - Playback is **managed globally** — only the most-visible video plays at any
 *   given time (Facebook / YouTube-style single-video autoplay).
 * - Respects `prefers-reduced-motion: reduce` and `Save-Data` — the video `src`
 *   is still lazy-loaded (so poster-frame extraction works), but auto-play is
 *   skipped and the card shows a manual play affordance instead.
 *
 * @param videoSrc  The video URL. Pass `undefined` when the media is not a video.
 * @param shouldAutoplay When false, the video still lazy-loads but will not auto-play.
 * @returns `{ videoRef, autoplayBlocked }` — attach `videoRef` to the `<video>` element.
 *   `autoplayBlocked` is true when the user prefers reduced motion or data saving.
 */
export function useVideoVisibility(videoSrc?: string, shouldAutoplay = true) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reducedMotion = useReducedMotion();
  const dataSaver = useDataSaver();
  const autoplayBlocked = reducedMotion || dataSaver;
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

          if (!autoplayBlocked && shouldAutoplay) {
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
      { threshold: [0, 0.15, 0.5, 0.75, 1] }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      manager.unregister(el);
    };
  }, [videoSrc, autoplayBlocked, shouldAutoplay, manager]);

  return { videoRef, reducedMotion: autoplayBlocked, autoplayBlocked };
}

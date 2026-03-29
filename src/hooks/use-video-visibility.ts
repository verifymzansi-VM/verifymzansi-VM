import { useEffect, useRef } from "react";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Hook that lazily loads and plays a video only when it scrolls into view.
 *
 * - The video `src` is NOT set until the element is ≥ 25 % visible, so pages
 *   with many video cards make **zero** video network requests on initial load.
 * - When the element scrolls out of view the video is paused to save bandwidth.
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

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSrc) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Lazily assign src the first time the element is visible
          if (!el.src) {
            el.src = videoSrc;
          }
          // Skip auto-play when user prefers reduced motion or playback is intentionally paused
          if (!reducedMotion && shouldAutoplay) {
            el.play().catch(() => {
              /* autoplay may be blocked */
            });
          } else {
            el.pause();
          }
        } else {
          el.pause();
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [videoSrc, reducedMotion, shouldAutoplay]);

  return { videoRef, reducedMotion };
}

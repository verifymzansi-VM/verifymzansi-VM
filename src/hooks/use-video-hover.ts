import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Hook that lazily loads a video on viewport visibility but only plays on hover.
 *
 * - The video `src` is NOT set until the element is ≥ 25 % visible, so pages
 *   with many video cards make **zero** video network requests on initial load.
 * - Video plays on `mouseenter` and pauses + rewinds on `mouseleave`.
 * - Respects `prefers-reduced-motion: reduce` — auto-play on hover is skipped.
 *
 * @param videoSrc The video URL. Pass `undefined` when the media is not a video.
 * @returns Attach `videoRef` to the `<video>`, `containerRef` to the outer wrapper.
 */
export function useVideoHover(videoSrc?: string) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const [isHovering, setIsHovering] = useState(false);

  // Lazy-load video src when scrolled into view
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSrc) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!el.src) {
            el.src = videoSrc;
          }
        } else {
          // Pause when out of viewport regardless of hover state
          el.pause();
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [videoSrc]);

  // Play/pause based on hover
  const onMouseEnter = useCallback(() => {
    setIsHovering(true);
    const el = videoRef.current;
    if (!el || reducedMotion) return;
    if (el.src) {
      el.play().catch(() => {
        /* autoplay may be blocked */
      });
    }
  }, [reducedMotion]);

  const onMouseLeave = useCallback(() => {
    setIsHovering(false);
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    // Reset to start so the poster shows cleanly next time
    el.currentTime = 0;
  }, []);

  // Attach hover listeners to the container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("mouseenter", onMouseEnter);
    container.addEventListener("mouseleave", onMouseLeave);
    return () => {
      container.removeEventListener("mouseenter", onMouseEnter);
      container.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [onMouseEnter, onMouseLeave]);

  return { videoRef, containerRef, reducedMotion, isHovering };
}

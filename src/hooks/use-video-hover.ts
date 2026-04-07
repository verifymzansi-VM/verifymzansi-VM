import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";

/**
 * Hook that lazily loads a video on viewport visibility but only plays on hover.
 *
 * - The video `src` is NOT set until the element is ≥ 15 % visible, so pages
 *   with many video cards make **zero** video network requests on initial load.
 * - Video plays on `mouseenter` and pauses + rewinds on `mouseleave`.
 * - Hover claims **exclusive playback priority** in the global playback manager
 *   so only the hovered video plays (other ambient videos are paused).
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
  const manager = useVideoPlaybackManager();

  // Register with manager + lazy-load video src when scrolled into view
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSrc) return;

    manager.register(el);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!el.src) {
            el.src = videoSrc;
          }
        } else {
          // Pause when out of viewport regardless of hover state
          el.pause();
          manager.updateVisibility(el, 0);
        }
      },
      { threshold: 0.15 }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      manager.unregister(el);
    };
  }, [videoSrc, manager]);

  // Play/pause based on hover — claims priority in the global manager
  const onMouseEnter = useCallback(() => {
    setIsHovering(true);
    const el = videoRef.current;
    if (!el || reducedMotion) return;
    if (el.src) {
      manager.requestPriority(el);
    }
  }, [reducedMotion, manager]);

  const onMouseLeave = useCallback(() => {
    setIsHovering(false);
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    manager.releasePriority(el);
  }, [manager]);

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

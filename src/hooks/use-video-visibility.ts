import { useEffect, useRef } from "react";

/**
 * Hook that lazily loads and plays a video only when it scrolls into view.
 *
 * - The video `src` is NOT set until the element is ≥ 25 % visible, so pages
 *   with many video cards make **zero** video network requests on initial load.
 * - When the element scrolls out of view the video is paused to save bandwidth.
 *
 * @param videoSrc  The video URL. Pass `undefined` when the media is not a video.
 * @returns `{ videoRef }` — attach `videoRef` to the `<video>` element.
 */
export function useVideoVisibility(videoSrc?: string) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
          el.play().catch(() => {
            /* autoplay may be blocked */
          });
        } else {
          el.pause();
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [videoSrc]);

  return { videoRef };
}

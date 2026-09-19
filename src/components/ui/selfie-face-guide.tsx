"use client";

import { useEffect, useState, type RefObject } from "react";
import { getSelfiePreviewRect } from "@/lib/verification/selfie-framing";

/** Place the guide over camera pixels, never over the letterboxed margins. */
export function SelfieFaceGuide({
  videoRef,
  passed,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  passed: boolean;
}) {
  const [preview, setPreview] = useState<ReturnType<typeof getSelfiePreviewRect>>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () =>
      setPreview(
        getSelfiePreviewRect(
          video.videoWidth,
          video.videoHeight,
          video.clientWidth,
          video.clientHeight
        )
      );
    update();
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("resize", update);
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(video);
    return () => {
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [videoRef]);

  if (!preview) return null;
  return (
    <div
      data-testid="selfie-face-guide"
      className="pointer-events-none absolute flex items-center justify-center"
      style={{ left: preview.left, top: preview.top, width: preview.width, height: preview.height }}
      aria-hidden="true"
    >
      <svg
        className="h-[80%] w-[80%] overflow-visible"
        viewBox="0 0 300 400"
        preserveAspectRatio="xMidYMid meet"
      >
        <ellipse
          cx="150"
          cy="200"
          rx="147"
          ry="197"
          fill="none"
          style={{ filter: "drop-shadow(0 0 2px black)" }}
          stroke={passed ? "#34d399" : "white"}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

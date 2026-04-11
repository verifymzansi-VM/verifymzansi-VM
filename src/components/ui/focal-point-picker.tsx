"use client";

import { useState, useCallback, useRef } from "react";
import Image from "next/image";
import { Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFocalPositionClassName } from "@/lib/utils/media-position-classes";

export interface FocalPoint {
  x: number; // 0..1 (left..right)
  y: number; // 0..1 (top..bottom)
}

interface FocalPointPickerProps {
  /** Image URL to display for focal point selection. */
  src: string;
  /** Alt text for the image. */
  alt?: string;
  /** Current focal point value. Defaults to centre (0.5, 0.5). */
  value?: FocalPoint;
  /** Called when the user clicks to set a new focal point. */
  onChange: (point: FocalPoint) => void;
  /** Additional className for the outer wrapper. */
  className?: string;
}

/**
 * Interactive focal-point picker.
 *
 * Shows the full image with a crosshair overlay. The user clicks (or taps)
 * anywhere on the image to set the "centre of interest". The focal point is
 * stored as normalised coordinates `{ x: 0–1, y: 0–1 }` and can be applied
 * via `object-position: ${x*100}% ${y*100}%` on media elements to control
 * how `object-cover` crops the image.
 */
export function FocalPointPicker({
  src,
  alt = "Set focal point",
  value = { x: 0.5, y: 0.5 },
  onChange,
  className,
}: FocalPointPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const focalPositionClassName = getFocalPositionClassName(value.x, value.y);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      onChange({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
    },
    [onChange]
  );

  const handleTouch = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || !e.touches[0]) return;

      const x = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.touches[0].clientY - rect.top) / rect.height));
      onChange({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
    },
    [onChange]
  );

  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-xs font-medium text-muted-foreground">
        Tap on the image to set the focal point
      </p>
      <div
        ref={containerRef}
        role="button"
        tabIndex={0}
        aria-label="Click to set focal point on image"
        className={cn(
          "relative cursor-crosshair overflow-hidden rounded-lg border border-warm-200 dark:border-warm-700",
          focalPositionClassName
        )}
        onClick={handleClick}
        onTouchStart={handleTouch}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onKeyDown={(e) => {
          // Arrow key nudging (1% per press)
          const step = 0.01;
          let { x, y } = value;
          if (e.key === "ArrowLeft") x = Math.max(0, x - step);
          else if (e.key === "ArrowRight") x = Math.min(1, x + step);
          else if (e.key === "ArrowUp") {
            y = Math.max(0, y - step);
            e.preventDefault();
          } else if (e.key === "ArrowDown") {
            y = Math.min(1, y + step);
            e.preventDefault();
          } else return;
          onChange({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
        }}
      >
        {/* Full image */}
        <div className="relative aspect-[9/16]">
          <Image
            src={src}
            alt={alt}
            fill
            className="object-contain"
            sizes="(max-width: 640px) 100vw, 400px"
            unoptimized={src.startsWith("blob:") || src.startsWith("data:") ? true : undefined}
          />
        </div>

        {/* Overlay grid lines (subtle) */}
        {hovering && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/3 top-0 h-full w-px bg-white/20" />
            <div className="absolute left-2/3 top-0 h-full w-px bg-white/20" />
            <div className="absolute left-0 top-1/3 h-px w-full bg-white/20" />
            <div className="absolute left-0 top-2/3 h-px w-full bg-white/20" />
          </div>
        )}

        {/* Focal point marker */}
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-all duration-150 left-[var(--focal-pos-x)] top-[var(--focal-pos-y)]">
          <div className="relative">
            <Crosshair className="h-8 w-8 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]" />
            <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-green shadow-sm" />
          </div>
        </div>

        {/* Semi-transparent scrim for better marker visibility */}
        <div className="pointer-events-none absolute inset-0 bg-black/10" />
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Move } from "lucide-react";
import { getFocalPositionClassName } from "@/lib/utils/media-position-classes";

export interface CropPosition {
  /** Focal point X: 0..1 (left..right). Equivalent to FocalPoint.x */
  x: number;
  /** Focal point Y: 0..1 (top..bottom). Equivalent to FocalPoint.y */
  y: number;
}

interface MediaCropPreviewProps {
  /** Image file to preview. */
  file: File;
  /** Target aspect ratio for the crop overlay (default: 16/9). */
  aspectRatio?: number;
  /** Current crop/focal position. Defaults to centre. */
  value?: CropPosition;
  /** Called when the user pans the crop overlay. */
  onChange: (pos: CropPosition) => void;
  /** Additional className for the outer wrapper. */
  className?: string;
}

/**
 * Interactive crop preview overlay.
 *
 * Shows the full uploaded image with a semi-transparent 16:9 (or custom)
 * crop overlay. The user drags/pans the image within the crop window to
 * position what will be visible on their listing card. Under the hood,
 * this stores a focal point (0–1, 0–1) compatible with the FocalPointPicker
 * and `object-position` CSS.
 */
export function MediaCropPreview({
  file,
  aspectRatio = 16 / 9,
  value = { x: 0.5, y: 0.5 },
  onChange,
  className,
}: MediaCropPreviewProps) {
  const containerRef = useRef<HTMLButtonElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; startVal: CropPosition } | null>(null);
  const focalPositionClassName = getFocalPositionClassName(value.x, value.y);

  // Create object URL for the image
  // Derive image URL from file (useMemo avoids setState-in-effect)
  const imageUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => {
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  // Read natural dimensions
  useEffect(() => {
    const img = new Image();
    img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = imageUrl;
  }, [imageUrl]);

  // Memoize the overlay label
  const overlayLabel = useMemo(() => {
    if (aspectRatio === 16 / 9) return "16:9 card";
    if (aspectRatio === 4 / 5) return "4:5 card";
    return `${aspectRatio.toFixed(2)} crop`;
  }, [aspectRatio]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY, startVal: { ...value } };
    },
    [value]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !dragStartRef.current || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const dx = (e.clientX - dragStartRef.current.x) / rect.width;
      const dy = (e.clientY - dragStartRef.current.y) / rect.height;

      // Invert: dragging right moves the crop window right → focal point moves left
      const newX = Math.max(0, Math.min(1, dragStartRef.current.startVal.x - dx));
      const newY = Math.max(0, Math.min(1, dragStartRef.current.startVal.y - dy));

      onChange({
        x: Math.round(newX * 1000) / 1000,
        y: Math.round(newY * 1000) / 1000,
      });
    },
    [isDragging, onChange]
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Move className="h-4 w-4" />
        Adjust how your image appears on cards
      </div>

      <div className={cn("flex items-start gap-4", focalPositionClassName)}>
        {/* Crop preview container */}
        <button
          type="button"
          ref={containerRef}
          className={cn(
            "relative w-40 cursor-grab overflow-hidden rounded-lg border-2 border-brand-green/40 touch-none select-none",
            isDragging && "cursor-grabbing"
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-label="Drag to position crop"
          onKeyDown={(e) => {
            const step = 0.02;
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
          {/* The image with object-position driven by focal point */}
          <div className="aspect-video">
            {imageUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={imageUrl}
                alt="Crop preview"
                className="focal-position-object h-full w-full object-cover"
                draggable={false}
              />
            )}
          </div>

          {/* Overlay badge */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
            <p className="text-[10px] font-medium text-white">{overlayLabel}</p>
          </div>
        </button>

        {/* Full image reference (dimmed) */}
        {naturalSize && (
          <div className="space-y-1">
            <div className="relative w-28 overflow-hidden rounded-lg border border-warm-200 opacity-60 dark:border-warm-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Full image" className="w-full" draggable={false} />
              {/* Focal point indicator */}
              <div className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-green shadow left-[var(--focal-pos-x)] top-[var(--focal-pos-y)]" />
            </div>
            <p className="text-[10px] text-muted-foreground">
              {naturalSize.w}×{naturalSize.h}px
            </p>
          </div>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Drag the image to position what&apos;s visible. The green box shows how your photo will
        appear on listing cards.
      </p>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/lib/utils/haptics";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MediaItem {
  url: string;
  kind: "photo" | "video";
  poster?: string;
}

interface MediaLightboxProps {
  items: MediaItem[];
  startIndex?: number;
  isOpen: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

function dist(a: React.Touch, b: React.Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MediaLightbox({ items, startIndex = 0, isOpen, onClose }: MediaLightboxProps) {
  const reducedMotion = useReducedMotion();

  /* ---- slide state ---- */
  const [index, setIndex] = useState(startIndex);
  // Sync startIndex when dialog opens — legitimate prop→state derivation
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing external prop to internal state on open
    if (isOpen) setIndex(startIndex);
  }, [isOpen, startIndex]);

  const item = items[index] as MediaItem | undefined;
  const total = items.length;

  /* ---- zoom state ---- */
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const isZoomed = scale > 1.05;

  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  /* ---- video state ---- */
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  /* ---- navigation ---- */
  const canPrev = index > 0;
  const canNext = index < total - 1;

  const goTo = useCallback(
    (i: number) => {
      if (isZoomed) return;
      if (i >= 0 && i < total) {
        setIndex(i);
        setScale(1);
        setTranslate({ x: 0, y: 0 });
        setIsPlaying(false);
        setIsMuted(true);
      }
    },
    [isZoomed, total]
  );

  /* ---- keyboard ---- */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft" && canPrev) goTo(index - 1);
      if (e.key === "ArrowRight" && canNext) goTo(index + 1);
    },
    [canPrev, canNext, goTo, index]
  );

  /* ---- swipe ---- */
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (isZoomed) return; // swipe disabled while zoomed
      if (e.touches.length === 1) {
        touchStart.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }
    },
    [isZoomed]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStart.current || isZoomed) return;
      const dx = e.changedTouches[0].clientX - touchStart.current.x;
      if (Math.abs(dx) > 50) {
        if (dx < 0 && canNext) goTo(index + 1);
        if (dx > 0 && canPrev) goTo(index - 1);
      }
      touchStart.current = null;
    },
    [isZoomed, canNext, canPrev, goTo, index]
  );

  /* ---- double-tap / double-click zoom ---- */
  const lastTapRef = useRef(0);

  const handleDoubleTap = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      if (item?.kind !== "photo") return;
      if (isZoomed) {
        resetZoom();
      } else {
        const originX = ((clientX - rect.left) / rect.width - 0.5) * -200;
        const originY = ((clientY - rect.top) / rect.height - 0.5) * -200;
        setScale(2);
        setTranslate({ x: originX, y: originY });
      }
    },
    [isZoomed, resetZoom, item?.kind]
  );

  const handleMediaClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const now = Date.now();
      if (now - lastTapRef.current < 350) {
        handleDoubleTap(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    },
    [handleDoubleTap]
  );

  const handleMediaTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length > 0) return; // still touching
      const now = Date.now();
      const touch = e.changedTouches[0];
      if (now - lastTapRef.current < 350) {
        handleDoubleTap(touch.clientX, touch.clientY, e.currentTarget.getBoundingClientRect());
        lastTapRef.current = 0;
        e.preventDefault();
      } else {
        lastTapRef.current = now;
      }
    },
    [handleDoubleTap]
  );

  /* ---- pinch zoom ---- */
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

  const handlePinchMove = useCallback(
    (e: React.TouchEvent) => {
      if (item?.kind !== "photo") return;
      if (e.touches.length === 2) {
        const d = dist(e.touches[0], e.touches[1]);
        if (!pinchRef.current) {
          pinchRef.current = { dist: d, scale };
        } else {
          const ratio = d / pinchRef.current.dist;
          setScale(clamp(pinchRef.current.scale * ratio, 1, 3));
        }
        e.preventDefault();
      }
    },
    [item?.kind, scale]
  );

  const handlePinchEnd = useCallback(() => {
    pinchRef.current = null;
    if (scale <= 1.05) resetZoom();
  }, [scale, resetZoom]);

  /* ---- pan while zoomed ---- */
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const handlePanStart = useCallback(
    (e: React.TouchEvent) => {
      if (!isZoomed || e.touches.length !== 1) return;
      panRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        tx: translate.x,
        ty: translate.y,
      };
    },
    [isZoomed, translate]
  );

  const handlePanMove = useCallback((e: React.TouchEvent) => {
    if (!panRef.current || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - panRef.current.x;
    const dy = e.touches[0].clientY - panRef.current.y;
    setTranslate({
      x: panRef.current.tx + dx,
      y: panRef.current.ty + dy,
    });
    e.preventDefault();
  }, []);

  const handlePanEnd = useCallback(() => {
    panRef.current = null;
  }, []);

  /* ---- combined touch handlers ---- */
  const onTouchStartCombined = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2) {
        pinchRef.current = null; // reset for new pinch
      } else if (isZoomed && e.touches.length === 1) {
        handlePanStart(e);
      } else {
        handleTouchStart(e);
      }
    },
    [isZoomed, handlePanStart, handleTouchStart]
  );

  const onTouchMoveCombined = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2) {
        handlePinchMove(e);
      } else if (isZoomed && e.touches.length === 1) {
        handlePanMove(e);
      }
    },
    [isZoomed, handlePinchMove, handlePanMove]
  );

  const onTouchEndCombined = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (pinchRef.current) {
        handlePinchEnd();
      } else if (isZoomed) {
        handlePanEnd();
      } else {
        handleTouchEnd(e);
      }
      handleMediaTouchEnd(e);
    },
    [isZoomed, handlePinchEnd, handlePanEnd, handleTouchEnd, handleMediaTouchEnd]
  );

  /* ---- mouse drag to pan (desktop) ---- */
  const mousePanRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isZoomed) return;
      mousePanRef.current = {
        x: e.clientX,
        y: e.clientY,
        tx: translate.x,
        ty: translate.y,
      };
    },
    [isZoomed, translate]
  );

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!mousePanRef.current) return;
    setTranslate({
      x: mousePanRef.current.tx + (e.clientX - mousePanRef.current.x),
      y: mousePanRef.current.ty + (e.clientY - mousePanRef.current.y),
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    mousePanRef.current = null;
  }, []);

  /* ---- video controls ---- */
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }, []);

  const enterFullscreen = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (v.requestFullscreen) {
        v.requestFullscreen();
      } else if (
        (v as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen
      ) {
        (v as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
      }
    } catch {
      /* fullscreen not supported */
    }
  }, []);

  /* ---- close handler ---- */
  const handleClose = useCallback(() => {
    triggerHaptic("light");
    resetZoom();
    onClose();
  }, [onClose, resetZoom]);

  if (!item) return null;

  const normalizedUrl = normalizeMediaUrl(item.url);
  const normalizedPoster = item.poster ? normalizeMediaUrl(item.poster) : undefined;

  const transitionClass = reducedMotion ? "" : "transition-transform duration-200 ease-out";

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <DialogPrimitive.Content
          className="fixed inset-0 z-[100] flex flex-col outline-none"
          onKeyDown={handleKeyDown}
          aria-label="Media gallery"
        >
          <DialogPrimitive.Title className="sr-only">
            Media viewer — {index + 1} of {total}
          </DialogPrimitive.Title>

          {/* ---- top bar ---- */}
          <div className="flex items-center justify-between px-4 pt-4 safe-area-inset-top">
            <span className="rounded-full bg-black/50 px-3 py-1 text-sm font-medium text-white/80">
              {index + 1} / {total}
            </span>

            <DialogPrimitive.Close asChild>
              <button
                className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
                aria-label="Close"
              >
                <X className="h-6 w-6" />
              </button>
            </DialogPrimitive.Close>
          </div>

          {/* ---- media area ---- */}
          <div
            className="relative flex-1 flex items-center justify-center overflow-hidden"
            onTouchStart={onTouchStartCombined}
            onTouchMove={onTouchMoveCombined}
            onTouchEnd={onTouchEndCombined}
            onClick={handleMediaClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            role="presentation"
          >
            {/* nav arrows */}
            {total > 1 && !isZoomed && (
              <>
                {canPrev && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      goTo(index - 1);
                    }}
                    className="absolute left-3 z-20 rounded-full bg-black/60 p-2.5 text-white transition-colors hover:bg-black/80"
                    aria-label="Previous"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                )}
                {canNext && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      goTo(index + 1);
                    }}
                    className="absolute right-3 z-20 rounded-full bg-black/60 p-2.5 text-white transition-colors hover:bg-black/80"
                    aria-label="Next"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                )}
              </>
            )}

            {/* media container */}
            <div
              className={cn(
                "relative w-full max-w-5xl mx-4 select-none",
                item.kind === "photo" ? "aspect-[3/4] sm:aspect-video" : "aspect-video",
                transitionClass,
                isZoomed && "cursor-grab active:cursor-grabbing"
              )}
              style={{
                transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
              }}
            >
              {item.kind === "video" ? (
                <>
                  <video
                    ref={videoRef}
                    key={normalizedUrl}
                    src={normalizedUrl}
                    poster={normalizedPoster}
                    autoPlay
                    muted
                    loop
                    playsInline
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    className="absolute inset-0 h-full w-full rounded-xl object-contain bg-black"
                    aria-label="Video player"
                  >
                    <track kind="captions" />
                  </video>

                  {/* video controls overlay */}
                  <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePlay();
                      }}
                      className="rounded-full bg-black/60 p-2.5 text-white transition-colors hover:bg-black/80"
                      aria-label={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? (
                        <Pause className="h-5 w-5" />
                      ) : (
                        <Play className="h-5 w-5 fill-white" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMute();
                      }}
                      className="rounded-full bg-black/60 p-2.5 text-white transition-colors hover:bg-black/80"
                      aria-label={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        enterFullscreen();
                      }}
                      className="rounded-full bg-black/60 p-2.5 text-white transition-colors hover:bg-black/80"
                      aria-label="Fullscreen"
                    >
                      <Maximize2 className="h-5 w-5" />
                    </button>
                  </div>
                </>
              ) : (
                <Image
                  src={normalizedUrl}
                  alt={`Photo ${index + 1} of ${total}`}
                  fill
                  className="rounded-xl object-contain"
                  sizes="100vw"
                  priority
                  draggable={false}
                />
              )}
            </div>
          </div>

          {/* ---- thumbnail strip ---- */}
          {total > 1 && (
            <div className="flex justify-center gap-2 px-4 pb-4 pt-2 safe-area-inset-bottom overflow-x-auto scrollbar-hide">
              {items.map((it, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    goTo(i);
                  }}
                  className={cn(
                    "relative flex-shrink-0 h-12 w-12 rounded-lg overflow-hidden border-2 transition-all",
                    i === index
                      ? "border-white ring-2 ring-white/30 shadow-md"
                      : "border-transparent opacity-60 hover:opacity-100"
                  )}
                  aria-label={`Go to ${it.kind} ${i + 1}`}
                >
                  {it.kind === "video" ? (
                    <div className="flex h-full w-full items-center justify-center bg-black/80">
                      <Play className="h-4 w-4 fill-white text-white" />
                    </div>
                  ) : (
                    <Image
                      src={normalizeMediaUrl(it.url)}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="48px"
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/lib/utils/haptics";
import { VideoCardPlayer, isVideoUrl } from "./video-card-player";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

interface LightboxProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl?: string;
  posterUrl?: string;
  title?: string;
}

export function Lightbox({ isOpen, onClose, imageUrl, posterUrl, title }: LightboxProps) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  // Clean up close animation timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    triggerHaptic("light");
    setClosing(true);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setClosing(false);
      onClose();
    }, 200); // match animation duration
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  const isVideo = isVideoUrl(imageUrl);
  const normalizedImageUrl = imageUrl ? normalizeMediaUrl(imageUrl) : undefined;
  const normalizedPosterUrl = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-md transition-opacity duration-200",
        closing ? "opacity-0" : "opacity-100"
      )}
      onClick={handleClose}
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") handleClose();
      }}
      tabIndex={-1}
    >
      <div className="flex justify-end p-4 safe-area-inset-top">
        <button
          className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors pointer-events-auto"
          onClick={(e) => {
            e.stopPropagation();
            handleClose();
          }}
          aria-label="Close preview"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      <div
        className={cn(
          "flex-1 flex items-center justify-center p-4 transition-transform duration-200",
          closing ? "scale-95" : "scale-100"
        )}
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="relative w-full max-w-4xl mx-auto aspect-[4/5] sm:aspect-video rounded-xl overflow-hidden bg-black shadow-2xl">
          {normalizedImageUrl ? (
            isVideo ? (
              <VideoCardPlayer
                src={imageUrl!}
                posterUrl={normalizedPosterUrl}
                alt={title || "Media preview"}
                sizes="100vw"
              />
            ) : (
              <Image
                src={normalizedImageUrl}
                alt={title || "Media preview"}
                fill
                className="object-contain"
                sizes="100vw"
                priority
              />
            )
          ) : (
            <div className="flex items-center justify-center h-full text-white/50">
              <span className="text-lg">No media available</span>
            </div>
          )}
        </div>
      </div>

      {title && (
        <div className="p-6 pb-8 safe-area-inset-bottom text-center">
          <h2 className="text-white font-display text-lg font-semibold line-clamp-2">{title}</h2>
        </div>
      )}
    </div>,
    document.body
  );
}

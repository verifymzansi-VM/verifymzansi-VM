"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Camera, RotateCcw } from "lucide-react";

interface VideoFrameSelectorProps {
  /** Video File to scrub for a poster frame. */
  file: File;
  /** Called when the user selects a frame (JPEG File). */
  onFrameSelect: (frame: File | null) => void;
  /** Additional className for the outer wrapper. */
  className?: string;
}

/**
 * Interactive video frame scrubber.
 *
 * Displays a video timeline bar that the user can scrub to pick
 * a poster frame. The selected frame is captured as a JPEG File
 * via canvas, and a 9:16 card preview is rendered alongside.
 */
export function VideoFrameSelector({ file, onFrameSelect, className }: VideoFrameSelectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewBlobUrlRef = useRef<string | null>(null);
  const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewForKey, setPreviewForKey] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [autoSelectedForKey, setAutoSelectedForKey] = useState<string | null>(null);
  const videoUrl = useMemo(() => URL.createObjectURL(file), [file]);

  const revokePreviewBlobUrl = useCallback(() => {
    if (!previewBlobUrlRef.current) return;
    URL.revokeObjectURL(previewBlobUrlRef.current);
    previewBlobUrlRef.current = null;
  }, []);

  useEffect(() => {
    revokePreviewBlobUrl();
  }, [file, revokePreviewBlobUrl]);

  // Cleanup object URL
  useEffect(() => {
    return () => URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    return () => revokePreviewBlobUrl();
  }, [revokePreviewBlobUrl]);

  // Auto-select a frame at 1s (or 10% of duration) once metadata loads
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    if (autoSelectedForKey !== fileKey) {
      const seekTarget = Math.min(1, video.duration * 0.1);
      video.currentTime = Math.max(0, seekTarget);
    }
  }, [autoSelectedForKey, fileKey]);

  // Capture the frame when the user seeks or on initial auto-select
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCurrentTime(video.currentTime);

    // Export as JPEG File
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        revokePreviewBlobUrl();
        const blobUrl = URL.createObjectURL(blob);
        previewBlobUrlRef.current = blobUrl;
        setPreviewUrl(blobUrl);
        setPreviewForKey(fileKey);
        const posterName = file.name.replace(/\.[^.]+$/, "_poster.jpg");
        const posterFile = new File([blob], posterName, { type: "image/jpeg" });
        onFrameSelect(posterFile);
      },
      "image/jpeg",
      0.85
    );

    if (autoSelectedForKey !== fileKey) setAutoSelectedForKey(fileKey);
  }, [autoSelectedForKey, file.name, fileKey, onFrameSelect, revokePreviewBlobUrl]);

  // Handle seeked event (both user-initiated and auto)
  const handleSeeked = useCallback(() => {
    captureFrame();
    setIsCapturing(false);
  }, [captureFrame]);

  // Handle scrub bar change
  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const time = parseFloat(e.target.value);
    setIsCapturing(true);
    video.currentTime = time;
  }, []);

  // Auto-select (reset to 1s)
  const handleAutoSelect = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const seekTarget = Math.min(1, duration * 0.1);
    setIsCapturing(true);
    video.currentTime = Math.max(0, seekTarget);
  }, [duration]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className={cn("space-y-3", className)}>
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Camera className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Choose video cover frame
      </p>

      {/* Hidden video element for seeking */}
      <video
        ref={videoRef}
        src={videoUrl}
        preload="auto"
        muted
        playsInline
        className="sr-only"
        onLoadedMetadata={handleLoadedMetadata}
        onSeeked={handleSeeked}
      />

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="sr-only" />

      {/* Scrub bar */}
      {duration > 0 && (
        <div className="space-y-1.5">
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={currentTime}
            onChange={handleScrub}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-brand-green-600"
            aria-label="Scrub video timeline to select poster frame"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}

      {/* Preview + actions */}
      {previewUrl && previewForKey === fileKey && (
        <div className="flex items-start gap-3">
          {/* 9:16 card preview */}
          <div className="relative w-32 overflow-hidden rounded-xl border border-border">
            <div className="aspect-[9/16]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Selected video frame"
                className={cn(
                  "h-full w-full object-cover transition-opacity duration-200",
                  isCapturing && "opacity-50"
                )}
              />
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
              <p className="text-[11px] font-medium text-white">Card preview</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={handleAutoSelect}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Auto-select
            </button>
            <p className="text-xs text-muted-foreground">Or drag the slider.</p>
          </div>
        </div>
      )}
    </div>
  );
}

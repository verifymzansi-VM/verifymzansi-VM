"use client";

import { useState, useCallback, useRef } from "react";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { generateBlurHash } from "@/lib/utils/blurhash";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import type { CompressionResult } from "@/lib/media/video-compressor";

interface UploadState {
  isUploading: boolean;
  /** Whether video compression is in progress (before upload begins) */
  isCompressing: boolean;
  /** Compression progress 0-100 (only meaningful when isCompressing is true) */
  compressionProgress: number;
  progress: number;
  error: string | null;
  url: string | null;
}

/** Captured media dimensions for CLS prevention and quality checks. */
export interface MediaDimensions {
  width: number;
  height: number;
  aspectRatio: number;
  duration?: number;
}

interface UploadOptions {
  bucket?: "public" | "private";
  maxSizeMB?: number;
  allowedTypes?: string[];
  /** Upload area for storage key generation (e.g., "listing", "business") */
  area?: string;
  /** Maximum video duration in seconds (default: 120 = 2 minutes) */
  maxDurationSec?: number;
  /** Called with amber-level quality warnings (non-blocking). */
  onQualityWarning?: (message: string) => void;
}

const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);

/** Max video duration default: 2 minutes */
const DEFAULT_MAX_DURATION_SEC = 120;

/**
 * Extract a poster frame from a video at a given seek time.
 * Returns a JPEG File (or null if extraction fails).
 */
function extractVideoFrame(file: File, seekTimeSec: number = 1): Promise<File | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 15_000);

    video.addEventListener("loadedmetadata", () => {
      const dur = video.duration;
      // Seek to the earlier of seekTimeSec or 10% of duration
      const target = Number.isFinite(dur)
        ? Math.min(seekTimeSec, dur * 0.1, dur - 0.01)
        : seekTimeSec;
      video.currentTime = Math.max(0, target);
    });

    video.addEventListener(
      "seeked",
      () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx || canvas.width === 0 || canvas.height === 0) {
            clearTimeout(timer);
            cleanup();
            resolve(null);
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => {
              clearTimeout(timer);
              cleanup();
              if (!blob) {
                resolve(null);
                return;
              }
              const posterName = file.name.replace(/\.[^.]+$/, "_poster.jpg");
              resolve(new File([blob], posterName, { type: "image/jpeg" }));
            },
            "image/jpeg",
            0.85
          );
        } catch {
          clearTimeout(timer);
          cleanup();
          resolve(null);
        }
      },
      { once: true }
    );

    video.addEventListener("error", () => {
      clearTimeout(timer);
      cleanup();
      resolve(null);
    });

    video.src = url;
  });
}

/**
 * Read video duration and dimensions client-side using a temporary <video> element.
 * Returns metadata or null if it cannot be read.
 */
function getVideoMeta(
  file: File
): Promise<{ duration: number | null; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    video.addEventListener("loadedmetadata", () => {
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;
      cleanup();
      resolve({
        duration: Number.isFinite(duration) ? duration : null,
        width: width || 0,
        height: height || 0,
      });
    });

    video.addEventListener("error", () => {
      cleanup();
      resolve(null);
    });

    // Timeout after 10 s — metadata should load nearly instantly from a local blob
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 10_000);

    video.addEventListener("loadedmetadata", () => clearTimeout(timer), { once: true });
    video.addEventListener("error", () => clearTimeout(timer), { once: true });

    video.src = url;
  });
}

/**
 * Read image dimensions client-side via a temporary Image element.
 */
function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();

    const cleanup = () => {
      URL.revokeObjectURL(url);
    };

    img.addEventListener("load", () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      cleanup();
      resolve({ width, height });
    });

    img.addEventListener("error", () => {
      cleanup();
      resolve(null);
    });

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5_000);

    img.addEventListener("load", () => clearTimeout(timer), { once: true });
    img.addEventListener("error", () => clearTimeout(timer), { once: true });

    img.src = url;
  });
}

/** Emit non-blocking quality warnings for low-res or extreme aspect ratio media. */
function checkQualityWarnings(
  dims: { width: number; height: number },
  isVideo: boolean,
  onWarn?: (msg: string) => void
) {
  if (!onWarn || dims.width === 0 || dims.height === 0) return;

  const minDim = Math.min(dims.width, dims.height);
  const ratio = dims.width / dims.height;

  if (isVideo && minDim < 480) {
    onWarn("Low resolution video — may look pixelated on larger screens.");
  } else if (!isVideo && minDim < 640) {
    onWarn("Low resolution image — may appear blurry on larger screens.");
  }

  if (ratio > 3 || ratio < 1 / 4) {
    onWarn("Extreme aspect ratio — this media will be significantly letterboxed in cards.");
  }

  if (ratio > 1) {
    onWarn("Landscape media will be cropped in the 9:16 card. Portrait photos/videos look best.");
  }
}

/** Types eligible for client-side WebP conversion (JPEG excluded — savings minimal for photos). */
const WEBP_CONVERTIBLE = new Set(["image/png", "image/bmp"]);

/**
 * Convert a PNG/BMP image to WebP client-side via canvas.
 * Returns the original file unchanged if conversion fails or produces a larger result.
 */
function convertToWebP(file: File): Promise<File> {
  if (!WEBP_CONVERTIBLE.has(file.type)) return Promise.resolve(file);

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();

    const cleanup = () => URL.revokeObjectURL(url);

    img.addEventListener("load", () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve(file);
          return;
        }

        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            cleanup();
            if (!blob || blob.size >= file.size) {
              // Conversion produced a larger file — keep original
              resolve(file);
              return;
            }
            const baseName = file.name.replace(/\.[^.]+$/, "");
            resolve(new File([blob], `${baseName}.webp`, { type: "image/webp" }));
          },
          "image/webp",
          0.85
        );
      } catch {
        cleanup();
        resolve(file);
      }
    });

    img.addEventListener("error", () => {
      cleanup();
      resolve(file);
    });

    // Timeout — if image is too large to decode, skip conversion
    const timer = setTimeout(() => {
      cleanup();
      resolve(file);
    }, 10_000);
    img.addEventListener("load", () => clearTimeout(timer), { once: true });
    img.addEventListener("error", () => clearTimeout(timer), { once: true });

    img.src = url;
  });
}

/**
 * Hook for uploading files to R2 storage.
 *
 * Images and videos use the /api/media/upload proxy so the server can validate
 * magic bytes, scan content, and track orphan cleanup consistently.
 */
export function useMediaUpload(options: UploadOptions = {}) {
  const {
    bucket = "public",
    maxSizeMB = 5,
    allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/avif"],
    area = "listing",
    maxDurationSec = DEFAULT_MAX_DURATION_SEC,
    onQualityWarning,
  } = options;

  const [state, setState] = useState<UploadState>({
    isUploading: false,
    isCompressing: false,
    compressionProgress: 0,
    progress: 0,
    error: null,
    url: null,
  });

  const [dimensions, setDimensions] = useState<MediaDimensions | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [blurhash, setBlurhash] = useState<string | null>(null);
  const [compressionResult, setCompressionResult] = useState<CompressionResult | null>(null);
  const compressionAbortRef = useRef<AbortController | null>(null);

  const validate = useCallback(
    (file: File): string | null => {
      const isVideo = VIDEO_TYPES.has(file.type);
      const effectiveMax = isVideo ? 50 : maxSizeMB;

      if (file.size > effectiveMax * 1024 * 1024) {
        return `File too large. Maximum size is ${effectiveMax}MB.`;
      }

      const allAllowed = [...allowedTypes, ...VIDEO_TYPES];
      if (allAllowed.length > 0 && !allAllowed.includes(file.type)) {
        return `File type "${file.type}" not allowed. Accepted: ${allAllowed.join(", ")}`;
      }
      return null;
    },
    [maxSizeMB, allowedTypes]
  );

  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      const validationError = validate(file);
      if (validationError) {
        setState({
          isUploading: false,
          isCompressing: false,
          compressionProgress: 0,
          progress: 0,
          error: validationError,
          url: null,
        });
        return null;
      }

      setCompressionResult(null);
      setState({
        isUploading: true,
        isCompressing: false,
        compressionProgress: 0,
        progress: 0,
        error: null,
        url: null,
      });

      const isVideo = VIDEO_TYPES.has(file.type);

      // ── Video duration + dimension check (client-side) ───────────────
      if (isVideo) {
        setState((prev) => ({ ...prev, progress: 1 }));
        const meta = await getVideoMeta(file);
        const duration = meta?.duration ?? null;
        if (duration !== null && duration > maxDurationSec) {
          const maxMin = Math.floor(maxDurationSec / 60);
          const maxSec = maxDurationSec % 60;
          const label =
            maxMin > 0
              ? `${maxMin} minute${maxMin > 1 ? "s" : ""}${maxSec > 0 ? ` ${maxSec}s` : ""}`
              : `${maxDurationSec} seconds`;
          setState({
            isUploading: false,
            isCompressing: false,
            compressionProgress: 0,
            progress: 0,
            error: `Video is too long. Maximum duration is ${label}.`,
            url: null,
          });
          return null;
        }
        if (meta && meta.width > 0 && meta.height > 0) {
          const dims: MediaDimensions = {
            width: meta.width,
            height: meta.height,
            aspectRatio: meta.width / meta.height,
            duration: duration ?? undefined,
          };
          setDimensions(dims);
          checkQualityWarnings(meta, true, onQualityWarning);
        }
      } else {
        // ── Image dimension capture ─────────────────────────
        const imgDims = await getImageDimensions(file);
        if (imgDims && imgDims.width > 0 && imgDims.height > 0) {
          setDimensions({
            width: imgDims.width,
            height: imgDims.height,
            aspectRatio: imgDims.width / imgDims.height,
          });
          checkQualityWarnings(imgDims, false, onQualityWarning);
        }
      }

      try {
        // ── Video: compress + validated server upload ──────────
        if (isVideo) {
          // ── Compress video before upload ─────────────────────────
          compressionAbortRef.current?.abort();
          const compAbort = new AbortController();
          compressionAbortRef.current = compAbort;

          setState((prev) => ({
            ...prev,
            isCompressing: true,
            compressionProgress: 0,
            progress: 0,
          }));

          let uploadFile = file;
          try {
            const { compressVideo } = await import("@/lib/media/video-compressor");
            const result = await compressVideo(file, {
              onProgress: (pct) => {
                setState((prev) => ({ ...prev, compressionProgress: pct }));
              },
              signal: compAbort.signal,
            });
            setCompressionResult(result);
            uploadFile = result.file;
          } catch (compErr) {
            // Abort means user cancelled — bail out
            if (compErr instanceof DOMException && compErr.name === "AbortError") {
              setState({
                isUploading: false,
                isCompressing: false,
                compressionProgress: 0,
                progress: 0,
                error: null,
                url: null,
              });
              return null;
            }
            // Other errors — upload original file with a console warning
            console.warn("[use-media-upload] Compression failed, uploading original:", compErr);
          }

          setState((prev) => ({ ...prev, isCompressing: false, compressionProgress: 100 }));

          // 1. Upload through the validated server endpoint
          setState((prev) => ({ ...prev, progress: 2 }));

          const videoForm = new FormData();
          videoForm.append("files", uploadFile);
          videoForm.append("area", area);
          videoForm.append("bucket", bucket);

          const uploadResponse = await fetchWithRetry("/api/media/upload", {
            method: "POST",
            headers: withCsrfHeaders(),
            body: videoForm,
          });

          if (!uploadResponse.ok) {
            const data = await uploadResponse.json().catch(() => ({}));
            const errorMsg =
              ((data as Record<string, unknown>).error as string) ||
              `Upload failed (${uploadResponse.status})`;
            setState({
              isUploading: false,
              isCompressing: false,
              compressionProgress: 0,
              progress: 0,
              error: errorMsg,
              url: null,
            });
            return null;
          }

          const uploadResult = (await uploadResponse.json()) as {
            urls?: string[];
            errors?: string[];
            success?: boolean;
          };
          const publicUrl = uploadResult.urls?.[0] ?? null;
          if (!publicUrl) {
            const errorMsg = uploadResult.errors?.[0] ?? "Upload failed";
            setState({
              isUploading: false,
              isCompressing: false,
              compressionProgress: 0,
              progress: 0,
              error: errorMsg,
              url: null,
            });
            return null;
          }

          setState((prev) => ({ ...prev, progress: 95 }));

          // 2. Extract poster frame and upload it (non-blocking for main result)
          extractVideoFrame(uploadFile).then(async (posterFile) => {
            if (!posterFile) return;
            try {
              const posterForm = new FormData();
              posterForm.append("files", posterFile);
              posterForm.append("area", area);
              posterForm.append("bucket", bucket);
              const posterRes = await fetchWithRetry("/api/media/upload", {
                method: "POST",
                headers: withCsrfHeaders(),
                body: posterForm,
              });
              if (posterRes.ok) {
                const posterResult = (await posterRes.json()) as {
                  urls: string[];
                  success: boolean;
                };
                const url = posterResult.urls?.[0] ?? null;
                if (url) setPosterUrl(url);
              }
            } catch {
              // Poster extraction is best-effort — do not fail the main upload
            }
          });

          setState({
            isUploading: false,
            isCompressing: false,
            compressionProgress: 100,
            progress: 100,
            error: null,
            url: publicUrl,
          });
          return publicUrl;
        }

        // ── Image: proxy through server (small files) ─────────
        // Convert PNG/BMP to WebP client-side for bandwidth savings
        const uploadFile = await convertToWebP(file);

        const formData = new FormData();
        formData.append("files", uploadFile);
        formData.append("area", area);
        formData.append("bucket", bucket);

        setState((prev) => ({ ...prev, progress: 30 }));

        const response = await fetchWithRetry("/api/media/upload", {
          method: "POST",
          headers: withCsrfHeaders(),
          body: formData,
        });

        setState((prev) => ({ ...prev, progress: 80 }));

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const errorMsg =
            ((data as Record<string, unknown>).error as string) ||
            `Upload failed (${response.status})`;
          setState({
            isUploading: false,
            isCompressing: false,
            compressionProgress: 0,
            progress: 0,
            error: errorMsg,
            url: null,
          });
          return null;
        }

        const result = (await response.json()) as {
          urls: string[];
          success: boolean;
        };
        const url = result.urls?.[0] ?? null;
        setState({
          isUploading: false,
          isCompressing: false,
          compressionProgress: 0,
          progress: 100,
          error: null,
          url,
        });

        // Generate BlurHash from the uploaded image (non-blocking)
        if (url) {
          generateBlurHash(file).then((hash) => {
            if (hash) setBlurhash(hash);
          });
        }

        return url;
      } catch {
        setState({
          isUploading: false,
          isCompressing: false,
          compressionProgress: 0,
          progress: 0,
          error: "Upload failed. Please try again.",
          url: null,
        });
        return null;
      }
    },
    [bucket, validate, area, maxDurationSec, onQualityWarning]
  );

  const reset = useCallback(() => {
    compressionAbortRef.current?.abort();
    compressionAbortRef.current = null;
    setState({
      isUploading: false,
      isCompressing: false,
      compressionProgress: 0,
      progress: 0,
      error: null,
      url: null,
    });
    setDimensions(null);
    setPosterUrl(null);
    setBlurhash(null);
    setCompressionResult(null);
  }, []);

  return {
    ...state,
    dimensions,
    posterUrl,
    blurhash,
    compressionResult,
    upload,
    reset,
    validate,
  };
}

"use client";

import { useState, useCallback } from "react";
import { withCsrfHeaders } from "@/lib/utils/csrf";

interface UploadState {
  isUploading: boolean;
  progress: number;
  error: string | null;
  url: string | null;
}

interface UploadOptions {
  bucket?: "public" | "private";
  maxSizeMB?: number;
  allowedTypes?: string[];
  /** Upload area for storage key generation (e.g., "listing", "business") */
  area?: string;
  /** Maximum video duration in seconds (default: 120 = 2 minutes) */
  maxDurationSec?: number;
}

const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);

/** Max video duration default: 2 minutes */
const DEFAULT_MAX_DURATION_SEC = 120;

/**
 * Read video duration client-side using a temporary <video> element.
 * Returns duration in seconds, or null if metadata cannot be read.
 */
function getVideoDuration(file: File): Promise<number | null> {
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
      cleanup();
      resolve(Number.isFinite(duration) ? duration : null);
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
 * Upload a file directly to R2 using a presigned URL with real progress tracking.
 * Used for large video files to avoid proxying through the server.
 */
function uploadWithPresignedUrl(
  file: File,
  presignedUrl: string,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress(pct);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload was aborted"));
    });

    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.send(file);
  });
}

/**
 * Hook for uploading files to R2 storage.
 *
 * - Videos: uses presigned URL for direct client→R2 upload with real progress
 * - Images: uses the /api/media/upload proxy (files are small)
 */
export function useMediaUpload(options: UploadOptions = {}) {
  const {
    bucket = "public",
    maxSizeMB = 5,
    allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/avif"],
    area = "listing",
    maxDurationSec = DEFAULT_MAX_DURATION_SEC,
  } = options;

  const [state, setState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
    url: null,
  });

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
          progress: 0,
          error: validationError,
          url: null,
        });
        return null;
      }

      setState({ isUploading: true, progress: 0, error: null, url: null });

      const isVideo = VIDEO_TYPES.has(file.type);

      // ── Video duration check (client-side) ───────────────
      if (isVideo) {
        setState((prev) => ({ ...prev, progress: 1 }));
        const duration = await getVideoDuration(file);
        if (duration !== null && duration > maxDurationSec) {
          const maxMin = Math.floor(maxDurationSec / 60);
          const maxSec = maxDurationSec % 60;
          const label =
            maxMin > 0
              ? `${maxMin} minute${maxMin > 1 ? "s" : ""}${maxSec > 0 ? ` ${maxSec}s` : ""}`
              : `${maxDurationSec} seconds`;
          setState({
            isUploading: false,
            progress: 0,
            error: `Video is too long. Maximum duration is ${label}.`,
            url: null,
          });
          return null;
        }
      }

      try {
        // ── Video: presigned direct upload to R2 ──────────────
        if (isVideo) {
          // 1. Get presigned URL from our API
          setState((prev) => ({ ...prev, progress: 2 }));

          const urlResponse = await fetch("/api/media/upload-url", {
            method: "POST",
            headers: withCsrfHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type,
              size: file.size,
              area,
            }),
          });

          if (!urlResponse.ok) {
            const data = await urlResponse.json().catch(() => ({}));
            const errorMsg =
              ((data as Record<string, unknown>).error as string) ||
              `Failed to get upload URL (${urlResponse.status})`;
            setState({
              isUploading: false,
              progress: 0,
              error: errorMsg,
              url: null,
            });
            return null;
          }

          const { uploadUrl, publicUrl } = (await urlResponse.json()) as {
            uploadUrl: string;
            key: string;
            publicUrl: string;
          };

          // 2. Upload directly to R2 with real progress
          await uploadWithPresignedUrl(file, uploadUrl, (pct) => {
            setState((prev) => ({ ...prev, progress: pct }));
          });

          setState({
            isUploading: false,
            progress: 100,
            error: null,
            url: publicUrl,
          });
          return publicUrl;
        }

        // ── Image: proxy through server (small files) ─────────
        const formData = new FormData();
        formData.append("files", file);
        formData.append("area", area);
        formData.append("bucket", bucket);

        setState((prev) => ({ ...prev, progress: 30 }));

        const response = await fetch("/api/media/upload", {
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
        setState({ isUploading: false, progress: 100, error: null, url });
        return url;
      } catch {
        setState({
          isUploading: false,
          progress: 0,
          error: "Upload failed. Please try again.",
          url: null,
        });
        return null;
      }
    },
    [bucket, validate, area, maxDurationSec]
  );

  const reset = useCallback(() => {
    setState({ isUploading: false, progress: 0, error: null, url: null });
  }, []);

  return {
    ...state,
    upload,
    reset,
    validate,
  };
}

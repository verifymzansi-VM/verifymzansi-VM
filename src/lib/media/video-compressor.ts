/**
 * Client-side video compression using FFmpeg WASM.
 *
 * Lazy-loads the ~25 MB WASM binary only when compression is needed.
 * Uses single-threaded mode to avoid requiring COOP/COEP headers
 * that would break Cloudflare Turnstile and analytics scripts.
 *
 * Target output: MP4 H.264 baseline, ≤720p, 1.5 Mbps video, 128 Kbps AAC audio,
 * with -movflags +faststart for instant progressive playback.
 */

export interface CompressionOptions {
  /** Maximum width in pixels (default: 1280) */
  maxWidth?: number;
  /** Maximum height in pixels (default: 720) */
  maxHeight?: number;
  /** Video bitrate string for FFmpeg, e.g. "1.5M" (default: "1.5M") */
  videoBitrate?: string;
  /** Audio bitrate string for FFmpeg, e.g. "128k" (default: "128k") */
  audioBitrate?: string;
  /** FFmpeg encoding preset (default: "fast") */
  preset?: string;
  /** Keyframe interval in frames (default: 48 = 2s at 24fps) */
  keyframeInterval?: number;
  /** Skip compression if file is smaller than this in bytes (default: 2 MB) */
  skipBelowBytes?: number;
  /** Progress callback (0-100) */
  onProgress?: (percent: number) => void;
  /** AbortSignal to cancel compression */
  signal?: AbortSignal;
}

export interface CompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  skipped: boolean;
  /** Reason compression was skipped, if applicable */
  skipReason?: string;
}

const DEFAULT_OPTIONS: Required<Omit<CompressionOptions, "onProgress" | "signal">> = {
  maxWidth: 1280,
  maxHeight: 720,
  videoBitrate: "1.5M",
  audioBitrate: "128k",
  preset: "fast",
  keyframeInterval: 48,
  skipBelowBytes: 2 * 1024 * 1024, // 2 MB
};

/**
 * Read video dimensions using a temporary <video> element.
 */
function readVideoDimensions(
  file: File
): Promise<{ width: number; height: number; duration: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 10_000);

    video.addEventListener(
      "loadedmetadata",
      () => {
        clearTimeout(timer);
        const result = {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: Number.isFinite(video.duration) ? video.duration : 0,
        };
        cleanup();
        resolve(result.width > 0 ? result : null);
      },
      { once: true }
    );

    video.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        cleanup();
        resolve(null);
      },
      { once: true }
    );

    video.src = url;
  });
}

/**
 * Estimate video bitrate from file size and duration.
 * Returns bitrate in bits per second.
 */
function estimateBitrate(fileSizeBytes: number, durationSec: number): number {
  if (durationSec <= 0) return Infinity;
  return (fileSizeBytes * 8) / durationSec;
}

/** Determine if compression would produce a meaningful size reduction. */
function shouldSkipCompression(
  file: File,
  dims: { width: number; height: number; duration: number } | null,
  opts: Required<Omit<CompressionOptions, "onProgress" | "signal">>
): string | null {
  if (file.size < opts.skipBelowBytes) {
    return `File is ${(file.size / (1024 * 1024)).toFixed(1)} MB (below ${(opts.skipBelowBytes / (1024 * 1024)).toFixed(0)} MB threshold)`;
  }

  if (!dims) return null; // Can't determine — proceed with compression

  // Orientation-agnostic: cap the long edge at max(maxWidth, maxHeight)
  const maxDim = Math.max(opts.maxWidth, opts.maxHeight);
  const isWithinResolution = dims.width <= maxDim && dims.height <= maxDim;
  const bitrate = estimateBitrate(file.size, dims.duration);
  // 2 Mbps target threshold — if already below, compression won't help much
  const isLowBitrate = bitrate < 2_000_000;

  if (isWithinResolution && isLowBitrate) {
    return `Already ${dims.width}×${dims.height} at ${(bitrate / 1_000_000).toFixed(1)} Mbps`;
  }

  return null;
}

/**
 * Compress a video file using FFmpeg WASM.
 *
 * - Caps resolution at 720p (1280×720), preserving aspect ratio.
 * - Re-encodes to H.264 baseline + AAC.
 * - Adds -movflags +faststart for instant playback.
 * - Returns the original file unchanged if compression is skipped or fails.
 */
export async function compressVideo(
  file: File,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const originalSize = file.size;

  // ── Check if we should skip ──────────────────────────────
  const dims = await readVideoDimensions(file);
  const skipReason = shouldSkipCompression(file, dims, opts);
  if (skipReason) {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
      skipped: true,
      skipReason,
    };
  }

  // ── Check for abort before heavy work ────────────────────
  if (options.signal?.aborted) {
    throw new DOMException("Compression aborted", "AbortError");
  }

  try {
    // ── Lazy-load FFmpeg WASM ─────────────────────────────
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { fetchFile } = await import("@ffmpeg/util");

    const ffmpeg = new FFmpeg();

    // Wire up progress
    if (options.onProgress) {
      ffmpeg.on("progress", ({ progress }) => {
        // FFmpeg progress is 0-1 float
        options.onProgress!(Math.round(Math.min(progress, 1) * 100));
      });
    }

    // Wire up abort
    if (options.signal) {
      options.signal.addEventListener(
        "abort",
        () => {
          try {
            ffmpeg.terminate();
          } catch {
            // Already terminated
          }
        },
        { once: true }
      );
    }

    // Load FFmpeg (single-threaded — no SharedArrayBuffer needed)
    await ffmpeg.load();

    if (options.signal?.aborted) {
      ffmpeg.terminate();
      throw new DOMException("Compression aborted", "AbortError");
    }

    // ── Write input file to virtual filesystem ───────────
    const inputName = "input" + getExtension(file.name);
    const outputName = "output.mp4";

    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // ── Build FFmpeg command ─────────────────────────────
    // Scale filter: cap the long edge at max(maxWidth, maxHeight) to handle
    // both landscape AND portrait videos correctly. force_original_aspect_ratio
    // shrinks the output to fit within the bounding box. min() prevents upscaling.
    const maxDim = Math.max(opts.maxWidth, opts.maxHeight);
    const scaleFilter = `scale='min(${maxDim},iw)':'min(${maxDim},ih)':force_original_aspect_ratio=decrease`,
      // Ensure dimensions are divisible by 2 (H.264 requirement)
      padFilter = `pad=ceil(iw/2)*2:ceil(ih/2)*2`;

    const args = [
      "-i",
      inputName,
      "-vf",
      `${scaleFilter},${padFilter}`,
      "-c:v",
      "libx264",
      "-profile:v",
      "baseline",
      "-level",
      "3.1",
      "-preset",
      opts.preset,
      "-b:v",
      opts.videoBitrate,
      "-c:a",
      "aac",
      "-b:a",
      opts.audioBitrate,
      "-movflags",
      "+faststart",
      "-g",
      String(opts.keyframeInterval),
      "-y",
      outputName,
    ];

    await ffmpeg.exec(args);

    if (options.signal?.aborted) {
      ffmpeg.terminate();
      throw new DOMException("Compression aborted", "AbortError");
    }

    // ── Read output ──────────────────────────────────────
    const data = await ffmpeg.readFile(outputName);

    // Clean up virtual filesystem
    try {
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch {
      // Best-effort cleanup
    }

    ffmpeg.terminate();

    const blobPart: BlobPart = typeof data === "string" ? data : new Uint8Array(data);
    const compressedBlob = new Blob([blobPart], { type: "video/mp4" });
    const compressedSize = compressedBlob.size;

    // If compression made the file larger, return original
    if (compressedSize >= originalSize) {
      return {
        file,
        originalSize,
        compressedSize: originalSize,
        compressionRatio: 1,
        skipped: true,
        skipReason: "Compressed output was larger than original",
      };
    }

    const compressedFile = new File([compressedBlob], file.name.replace(/\.[^.]+$/, ".mp4"), {
      type: "video/mp4",
      lastModified: Date.now(),
    });

    return {
      file: compressedFile,
      originalSize,
      compressedSize,
      compressionRatio: originalSize / compressedSize,
      skipped: false,
    };
  } catch (err) {
    // Re-throw abort errors
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }

    // Compression failed — return original file with warning
    console.warn("[video-compressor] FFmpeg compression failed, uploading original:", err);
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
      skipped: true,
      skipReason: `Compression failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

function getExtension(filename: string): string {
  const match = filename.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : ".mp4";
}

/**
 * Client-side video remux and conversion using FFmpeg WASM (video plan,
 * phase 1b). Only files the keep rule (video-rule.ts) does not keep get here.
 *
 * Lazy-loads the ~32 MB WASM binary only when it is needed. The core is
 * self-hosted under /vendor (see scripts/vendor-wasm-assets.mjs) so the CSP
 * never has to trust a public CDN.
 * Uses single-threaded mode to avoid requiring COOP/COEP headers
 * that would break Cloudflare Turnstile and analytics scripts.
 *
 * Remux: the first video and sound streams copied into a faststart MP4.
 * Convert: H.264 High (level 4.0), up to 720p, CRF 23 capped at 3 Mbps,
 * 2-second keyframes; AAC sound copied, other sound encoded as AAC 128 kbps;
 * faststart. The caller checks the output against the keep rule.
 */
import type { VideoFileFacts } from "@/lib/media/video-length";

export interface TranscodeOptions {
  /** `remuxed`: copy the streams into a faststart MP4; `converted`: re-encode. */
  mode: "remuxed" | "converted";
  /** The picked file's facts, when its headers could be read. */
  facts: VideoFileFacts | null;
  /** Progress callback (0-100) */
  onProgress?: (percent: number) => void;
  /** AbortSignal to cancel the work */
  signal?: AbortSignal;
}

/** Converted size: long edge 1280, short edge 720, never upscaled. */
const MAX_LONG_EDGE = 1280;
const MAX_SHORT_EDGE = 720;
/** Clips up to this long use the sharper (slower) preset. */
const SHARP_PRESET_MAX_SECONDS = 30;
const FFMPEG_CORE_BASE_PATH = "/vendor/ffmpeg-core";
/** Where the picked file is mounted (read in slices, never copied whole). */
const INPUT_MOUNT = "/upload";
/** Largest input copied into the WASM heap when mounting is unavailable. */
const COPIED_INPUT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Download the self-hosted core and hand it to the worker as a blob URL.
 * The WASM is stored gzipped because it exceeds Cloudflare's 25 MiB per-asset
 * limit; inflate it here unless the host already decoded it in transit.
 */
async function loadFfmpegWasmURL(signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${FFMPEG_CORE_BASE_PATH}/ffmpeg-core.wasm.gz`, { signal });
  if (!response.ok) throw new Error(`FFmpeg core download failed (${response.status})`);
  let wasm = await response.blob();
  const magic = new Uint8Array(await wasm.slice(0, 2).arrayBuffer());
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    wasm = await new Response(wasm.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
  }
  return URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
}

/** The ffmpeg arguments after the input for a remux or a conversion. */
export function transcodeArguments(mode: TranscodeOptions["mode"], facts: VideoFileFacts | null) {
  const streams = ["-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1"];
  if (mode === "remuxed") return [...streams, "-c", "copy", "-movflags", "+faststart"];
  // Cap both edges for portrait, landscape and square video; min() never
  // upscales, and the pad keeps both sizes even (an H.264 requirement).
  const scale = `scale='min(iw,if(gte(iw,ih),${MAX_LONG_EDGE},${MAX_SHORT_EDGE}))':'min(ih,if(gte(iw,ih),${MAX_SHORT_EDGE},${MAX_LONG_EDGE}))':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2`;
  // 30 fps only when the source is faster (or its rate is unknown).
  const fps = facts && facts.video.fps > 0 && facts.video.fps <= 30.5 ? "" : "fps=30,";
  const sharp = facts !== null && facts.seconds <= SHARP_PRESET_MAX_SECONDS;
  // The buffer lets a clip briefly exceed 3 Mbps. Over a short clip that
  // burst would lift the average above the keep rule's 4 Mbps, so it is at
  // most 0.5 Mbit per second of clip (6 Mbit from 12 s).
  const buffer = facts ? Math.min(6000, Math.max(500, Math.round(facts.seconds * 500))) : 6000;
  return [
    ...streams,
    "-vf",
    `${fps}${scale}`,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level",
    "4.0",
    "-pix_fmt",
    "yuv420p",
    // superfast is visibly sharper; ultrafast keeps long clips within the
    // time limit (it ignores "high", which the keep rule allows).
    "-preset",
    sharp ? "superfast" : "ultrafast",
    "-crf",
    "23",
    "-maxrate",
    "3000k",
    "-bufsize",
    `${buffer}k`,
    "-g",
    "60",
    ...(facts?.audio === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "128k"]),
    "-movflags",
    "+faststart",
  ];
}

/**
 * Remux or convert a video with FFmpeg WASM into a new MP4 File. Throws when
 * the encoder fails or is aborted; the caller decides what the member sees.
 */
export async function transcodeVideo(file: File, options: TranscodeOptions): Promise<File> {
  if (options.signal?.aborted) {
    throw new DOMException("Compression aborted", "AbortError");
  }

  let dispose: (() => void) | undefined;
  let wasmURL: string | undefined;
  let mountedInput: (() => Promise<void>) | undefined;
  try {
    // ── Lazy-load FFmpeg WASM ─────────────────────────────
    const { FFmpeg, FFFSType } = await import("@ffmpeg/ffmpeg");
    const { fetchFile } = await import("@ffmpeg/util");

    const ffmpeg = new FFmpeg();
    const terminate = () => {
      try {
        ffmpeg.terminate();
      } catch {
        // Cleanup must not hide the conversion error.
      }
    };
    dispose = () => {
      options.signal?.removeEventListener("abort", terminate);
      terminate();
    };

    // Wire up progress
    if (options.onProgress) {
      ffmpeg.on("progress", ({ progress }) => {
        // FFmpeg progress is 0-1 float
        options.onProgress!(Math.round(Math.min(progress, 1) * 100));
      });
    }

    // Wire up abort
    if (options.signal) {
      options.signal.addEventListener("abort", terminate, { once: true });
      if (options.signal.aborted) throw new DOMException("Compression aborted", "AbortError");
    }

    // Next's production webpack build emits a classic worker. It must load
    // the UMD core through importScripts. An ESM core throws there, and the
    // package's dynamic-import fallback is compiled to an empty webpack
    // context (MODULE_NOT_FOUND), so selecting ESM breaks every conversion.
    // importScripts resolves relative to the worker chunk, so pass an
    // absolute same-origin URL.
    wasmURL = await loadFfmpegWasmURL(options.signal);
    await ffmpeg.load({
      coreURL: `${window.location.origin}${FFMPEG_CORE_BASE_PATH}/ffmpeg-core.js`,
      wasmURL,
    });

    if (options.signal?.aborted) {
      throw new DOMException("Compression aborted", "AbortError");
    }

    // ── Give the encoder the input ───────────────────────
    // Mounted read-only (WORKERFS): the encoder reads the file in slices, so a
    // 300 MB phone original is never copied whole into the WASM heap. Only if
    // mounting fails is a small file (up to 50 MB) copied in, as before.
    const inputName = "input" + getExtension(file.name);
    const outputName = "output.mp4";
    let inputPath = `${INPUT_MOUNT}/${inputName}`;
    try {
      await ffmpeg.createDir(INPUT_MOUNT);
      await ffmpeg.mount(
        FFFSType.WORKERFS,
        { blobs: [{ name: inputName, data: file }] },
        INPUT_MOUNT
      );
      mountedInput = async () => {
        await ffmpeg.unmount(INPUT_MOUNT);
        await ffmpeg.deleteDir(INPUT_MOUNT);
      };
    } catch (error) {
      if (file.size > COPIED_INPUT_MAX_BYTES) throw error;
      inputPath = inputName;
      await ffmpeg.writeFile(inputName, await fetchFile(file));
    }

    const args = [
      "-i",
      inputPath,
      ...transcodeArguments(options.mode, options.facts),
      "-y",
      outputName,
    ];

    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) throw new Error(`Video encoder exited with code ${exitCode}`);

    if (options.signal?.aborted) {
      throw new DOMException("Compression aborted", "AbortError");
    }

    // ── Read output ──────────────────────────────────────
    const data = await ffmpeg.readFile(outputName);

    // Clean up virtual filesystem
    try {
      if (!mountedInput) await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch {
      // Best-effort cleanup
    }

    const blobPart: BlobPart = typeof data === "string" ? data : new Uint8Array(data);
    const output = new File([blobPart], withMp4Extension(file.name), {
      type: "video/mp4",
      lastModified: Date.now(),
    });
    if (!output.size) throw new Error("Video encoder produced an empty file");
    return output;
  } catch (err) {
    if (options.signal?.aborted) throw new DOMException("Compression aborted", "AbortError");
    throw err;
  } finally {
    // Unmount on every path, errors included, so an encoder is never left
    // holding the picked file through a stale mount.
    await mountedInput?.().catch(() => {
      // Best-effort: the encoder is terminated next either way.
    });
    dispose?.();
    if (wasmURL) URL.revokeObjectURL(wasmURL);
  }
}

function getExtension(filename: string): string {
  const match = filename.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : ".mp4";
}

function withMp4Extension(filename: string): string {
  const trimmed = filename.trim();
  const safeName = trimmed || "video";
  return /\.[^.]+$/.test(safeName) ? safeName.replace(/\.[^.]+$/, ".mp4") : `${safeName}.mp4`;
}

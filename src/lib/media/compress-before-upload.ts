/**
 * Prepares a picked video for upload (video plan, phase 1b), with the keep
 * rule the upload server enforces (video-rule.ts):
 * - an MP4 that already meets the rule is kept untouched;
 * - a file whose streams meet it but whose container does not (MOV, moov at
 *   the end, extra tracks) is remuxed: streams copied, nothing re-encoded;
 * - anything else is converted.
 * A remux or conversion whose output still breaks the rule (or that fails or
 * times out) blocks the upload: the original is never published.
 *
 * The FFmpeg WASM encoder is lazy-loaded only for a remux or conversion, so a
 * kept file and pages without uploads pay nothing.
 */
import { MAX_VIDEO_UPLOAD_BYTES } from "@/lib/media/upload-policy";
import { readVideoBlobFacts, type VideoFileFacts } from "@/lib/media/video-length";
import { videoPreparation, videoRuleProblem, type VideoSource } from "@/lib/media/video-rule";
import { detectMimeFromMagicBytes } from "@/lib/utils/file-validation";

/** Shown when a required conversion fails. */
const VIDEO_CONVERSION_FAILED_MESSAGE =
  "We couldn't convert this video. Film it in 720p or export it as MP4, then try again.";
const VIDEO_TOO_LARGE_MESSAGE =
  "The converted video is larger than 50 MB. Film it in 720p or export it as MP4, then try again.";
const VIDEO_TOO_SLOW_MESSAGE =
  "This video took too long to convert. Film it in 720p or export it as MP4, then try again.";

export class VideoTranscodeError extends Error {
  constructor(message = VIDEO_CONVERSION_FAILED_MESSAGE) {
    super(message);
    this.name = "VideoTranscodeError";
  }
}

/** The file to upload and how it was made (stored with its facts). */
export type PreparedVideo = { file: File; source: VideoSource };

// Phone encodes can take several minutes, especially on a cold WASM download.
const PREPARATION_TIMEOUT_MS = 10 * 60_000;
let preparationQueue: Promise<void> = Promise.resolve();

function createTimeoutSignal(ms: number): {
  signal: AbortSignal;
  promise: Promise<never>;
  cancel: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let didTimeOut = false;
  let timeoutId: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      didTimeOut = true;
      const error = new DOMException("Video compression timed out", "AbortError");
      controller.abort(error);
      reject(error);
    }, ms);
  });

  return {
    signal: controller.signal,
    promise,
    cancel: () => clearTimeout(timeoutId),
    timedOut: () => didTimeOut,
  };
}

type VideoPreparationOptions = {
  timeoutMs?: number;
  /** Remux or conversion progress (0-100), from the encoder. */
  onProgress?: (percent: number) => void;
};

export function prepareVideoUpload(
  file: File,
  options?: VideoPreparationOptions
): Promise<PreparedVideo> {
  // A WASM instance holds both the input and output in memory. Multiple phone
  // videos must not compete for CPU/memory, or consume their timeout in a queue.
  const prepared = preparationQueue.then(() => prepareVideo(file, options));
  preparationQueue = prepared.then(
    () => undefined,
    () => {
      // The caller receives this failure through `prepared`; the queue only waits.
    }
  );
  return prepared;
}

/** Whether the file is an MP4 by its type and by its first bytes, as the server checks. */
async function isMp4(file: Blob): Promise<boolean> {
  if (file.type !== "video/mp4") return false;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return detectMimeFromMagicBytes(head) === "video/mp4";
}

/** How a picked video will be prepared, from its headers only. */
async function planPreparation(file: Blob): Promise<{
  source: VideoSource;
  facts: VideoFileFacts | null;
}> {
  const facts = await readVideoBlobFacts(file);
  return { source: videoPreparation(facts, file.size, await isMp4(file)), facts };
}

/**
 * Whether this video is remuxed or converted before upload (it is not an MP4
 * that meets the keep rule as it is).
 */
export async function videoNeedsConversion(file: Blob): Promise<boolean> {
  return (await planPreparation(file)).source !== "kept";
}

async function transcode(
  file: File,
  mode: "remuxed" | "converted",
  facts: VideoFileFacts | null,
  options?: VideoPreparationOptions
): Promise<File> {
  const { transcodeVideo } = await import("@/lib/media/video-compressor");
  const timeout = createTimeoutSignal(options?.timeoutMs ?? PREPARATION_TIMEOUT_MS);
  try {
    return await Promise.race([
      transcodeVideo(file, {
        mode,
        facts,
        signal: timeout.signal,
        ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
      }),
      timeout.promise,
    ]);
  } catch (error) {
    if (timeout.timedOut()) throw new VideoTranscodeError(VIDEO_TOO_SLOW_MESSAGE);
    console.warn(`[video] ${mode === "remuxed" ? "remux" : "conversion"} failed`, error);
    throw new VideoTranscodeError();
  } finally {
    timeout.cancel();
  }
}

/** The output's keep-rule problem (null when it can be stored as it is). */
async function outputProblem(output: File) {
  const facts = await readVideoBlobFacts(output);
  return facts ? videoRuleProblem(facts, output.size) : "unreadable";
}

async function prepareVideo(file: File, options?: VideoPreparationOptions): Promise<PreparedVideo> {
  const { source, facts } = await planPreparation(file);
  if (source === "kept") return { file, source };
  if (source === "remuxed") {
    // A remux takes seconds; one whose output still breaks the rule (a
    // container the copy cannot fix) falls back to a conversion.
    const remuxed = await transcode(file, "remuxed", facts, options).catch(() => null);
    if (remuxed && (await outputProblem(remuxed)) === null)
      return { file: remuxed, source: "remuxed" };
  }
  const converted = await transcode(file, "converted", facts, options);
  const problem = await outputProblem(converted);
  if (problem === "file_size" || converted.size > MAX_VIDEO_UPLOAD_BYTES)
    throw new VideoTranscodeError(VIDEO_TOO_LARGE_MESSAGE);
  if (problem) throw new VideoTranscodeError();
  return { file: converted, source: "converted" };
}

/**
 * Thin adapter that compresses a video file before upload.
 *
 * Lazy-loads the FFmpeg WASM compressor so non-upload pages pay zero cost.
 * Returns the (possibly compressed) File ready for upload.
 * Every stored video is MP4 (roadmap M4.4). Only a compatible MP4 (H.264/AAC
 * sample descriptions) within the 50 MB stored-file cap may be uploaded
 * unchanged when the optional compression is slow or fails. Everything else
 * (MOV, WebM, other MP4 codecs, an MP4 over 50 MB) must convert, and a failed
 * conversion blocks the upload: the original is never published. Track
 * inspection is not a full decode/integrity check.
 */
import { hasCompatibleMp4Tracks } from "@/lib/media/mp4-compatibility";
import { MAX_VIDEO_UPLOAD_BYTES } from "@/lib/media/upload-policy";

/** Shown when a required conversion fails. */
const VIDEO_CONVERSION_FAILED_MESSAGE =
  "We couldn't convert this video. Film it in 720p or export it as MP4, then try again.";

export class VideoTranscodeError extends Error {
  constructor(message = VIDEO_CONVERSION_FAILED_MESSAGE) {
    super(message);
    this.name = "VideoTranscodeError";
  }
}

/** Optional compression of a compatible MP4; a 2-minute clip needs about this long. */
const DEFAULT_COMPRESSION_TIMEOUT_MS = 2 * 60_000;
// MOV conversion is mandatory, unlike optional MP4/WebM compression. Phone
// encodes can take several minutes, especially on a cold WASM download.
const REQUIRED_CONVERSION_TIMEOUT_MS = 10 * 60_000;
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

export function compressVideoForUpload(
  file: File,
  options?: { requireCompatibleOutput?: boolean; timeoutMs?: number }
): Promise<File> {
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

async function prepareVideo(
  file: File,
  options?: { requireCompatibleOutput?: boolean; timeoutMs?: number }
): Promise<File> {
  const { compressVideo } = await import("@/lib/media/video-compressor");
  // WebM is converted like MOV: browser-made WebM often has no readable length.
  const needsConversion =
    file.type !== "video/mp4" ||
    file.size > MAX_VIDEO_UPLOAD_BYTES ||
    !(await hasCompatibleMp4Tracks(file));
  const timeout = createTimeoutSignal(
    options?.timeoutMs ??
      (needsConversion ? REQUIRED_CONVERSION_TIMEOUT_MS : DEFAULT_COMPRESSION_TIMEOUT_MS)
  );
  let result: Awaited<ReturnType<typeof compressVideo>>;

  try {
    result = await Promise.race([
      compressVideo(file, { signal: timeout.signal, forceTranscode: needsConversion }),
      timeout.promise,
    ]);
  } catch (error) {
    if (timeout.timedOut()) {
      if (!needsConversion) {
        return file;
      }
      throw new VideoTranscodeError(
        "This video took too long to convert. Film it in 720p or export it as MP4, then try again."
      );
    }
    throw error;
  } finally {
    timeout.cancel();
  }

  if (needsConversion && (result.skipped || result.file === file)) throw new VideoTranscodeError();
  if (options?.requireCompatibleOutput && result.file.type !== "video/mp4") {
    throw new VideoTranscodeError();
  }
  return result.file;
}

/**
 * Thin adapter that compresses a video file before upload.
 *
 * Lazy-loads the FFmpeg WASM compressor so non-upload pages pay zero cost.
 * Returns the (possibly compressed) File ready for presigned-URL PUT.
 * Compatible container types can fall back to the original on compression failure.
 * Required conversion failures block upload; container type is not codec validation.
 */
import { hasCompatibleMp4Tracks } from "@/lib/media/mp4-compatibility";
export class VideoTranscodeError extends Error {
  constructor(
    message = "This video could not be converted to a compatible MP4. Export it as H.264 MP4 and try again."
  ) {
    super(message);
    this.name = "VideoTranscodeError";
  }
}

const WEB_UPLOAD_VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const DEFAULT_COMPRESSION_TIMEOUT_MS = 60_000;
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
    () => undefined
  );
  return prepared;
}

async function prepareVideo(
  file: File,
  options?: { requireCompatibleOutput?: boolean; timeoutMs?: number }
): Promise<File> {
  const { compressVideo } = await import("@/lib/media/video-compressor");
  const needsConversion =
    !WEB_UPLOAD_VIDEO_TYPES.has(file.type) ||
    (file.type === "video/mp4" && !(await hasCompatibleMp4Tracks(file)));
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
        "This video took too long to convert to MP4. Try a shorter clip or export it as MP4 first."
      );
    }
    throw error;
  } finally {
    timeout.cancel();
  }

  if (needsConversion && (result.skipped || result.file === file)) throw new VideoTranscodeError();
  if (options?.requireCompatibleOutput && !WEB_UPLOAD_VIDEO_TYPES.has(result.file.type)) {
    throw new VideoTranscodeError();
  }
  return result.file;
}

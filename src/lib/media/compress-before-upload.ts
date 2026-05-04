/**
 * Thin adapter that compresses a video file before upload.
 *
 * Lazy-loads the FFmpeg WASM compressor so non-upload pages pay zero cost.
 * Returns the (possibly compressed) File ready for presigned-URL PUT.
 * On failure the original file is returned — upload still succeeds uncompressed.
 */
export class VideoTranscodeError extends Error {
  constructor(
    message = "This MOV video could not be converted to MP4. Export it as MP4 and try again."
  ) {
    super(message);
    this.name = "VideoTranscodeError";
  }
}

const WEB_UPLOAD_VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const DEFAULT_COMPRESSION_TIMEOUT_MS = 60_000;

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

export async function compressVideoForUpload(
  file: File,
  options?: { requireCompatibleOutput?: boolean; timeoutMs?: number }
): Promise<File> {
  const { compressVideo } = await import("@/lib/media/video-compressor");
  const timeout = createTimeoutSignal(options?.timeoutMs ?? DEFAULT_COMPRESSION_TIMEOUT_MS);
  let result: Awaited<ReturnType<typeof compressVideo>>;

  try {
    result = await Promise.race([compressVideo(file, { signal: timeout.signal }), timeout.promise]);
  } catch (error) {
    if (timeout.timedOut()) {
      if (WEB_UPLOAD_VIDEO_TYPES.has(file.type)) {
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

  if (options?.requireCompatibleOutput && result.file.type === "video/quicktime") {
    throw new VideoTranscodeError();
  }
  return result.file;
}

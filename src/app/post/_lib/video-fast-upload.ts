import { compressVideoForUpload, VideoTranscodeError } from "@/lib/media/compress-before-upload";
import { MAX_VIDEO_ORIGINAL_BYTES, MAX_VIDEO_UPLOAD_BYTES } from "@/lib/media/upload-policy";
import { MAX_VIDEO_SECONDS, videoLengthProblem } from "@/lib/media/video-length";
import { readVideoLengthSeconds } from "@/lib/media/video-length-client";
import { normalizeSelectedFile } from "@/lib/utils/media-upload";
import { createLogger } from "@/lib/utils/logger";
import type { UploadArea } from "@/types/enums";

const log = createLogger("VideoFastUpload");

const preparedVideoUploads = new WeakMap<File, Promise<File>>();
const uploadedVideos = new WeakMap<
  File,
  Map<UploadArea, { promise: Promise<string>; expires: number }>
>();
let activeUploads = 0;
const waitingUploads: Array<() => void> = [];

async function withUploadSlot<T>(upload: () => Promise<T>): Promise<T> {
  if (activeUploads >= 2) await new Promise<void>((resolve) => waitingUploads.push(resolve));
  else activeUploads++;
  try {
    return await upload();
  } finally {
    const next = waitingUploads.shift();
    if (next) next();
    else activeUploads--;
  }
}

/** The form's length rule, checked again at submit: a post's kind can change after the pick. */
async function assertVideoLength(file: File, maxSeconds: number): Promise<void> {
  const problem = videoLengthProblem(await readVideoLengthSeconds(file), maxSeconds);
  if (problem) throw new VideoTranscodeError(`${problem}.`);
}

async function prepareVideoForUpload(file: File): Promise<File> {
  // A larger original is accepted only to be converted; 50 MB caps the stored file.
  if (!file.size || file.size > MAX_VIDEO_ORIGINAL_BYTES) {
    throw new VideoTranscodeError("Select a non-empty video up to 300 MB.");
  }
  const existing = preparedVideoUploads.get(file);
  if (existing) {
    return existing;
  }

  const prepared = compressVideoForUpload(file, {
    requireCompatibleOutput: true,
  })
    .then((preparedFile) => {
      if (!preparedFile.size || preparedFile.size > MAX_VIDEO_UPLOAD_BYTES) {
        throw new VideoTranscodeError(
          "The converted video is larger than 50 MB. Film it in 720p or export it as MP4, then try again."
        );
      }
      return normalizeSelectedFile(preparedFile);
    })
    .catch((error) => {
      preparedVideoUploads.delete(file);
      throw error;
    });
  preparedVideoUploads.set(file, prepared);
  return prepared;
}

export function prewarmVideoForFastUpload(file: File): Promise<File> {
  return prepareVideoForUpload(file);
}

export function prewarmVideosForFastUpload(files: File[]): void {
  for (const file of files) {
    void prewarmVideoForFastUpload(file).catch((error) => {
      log.warn("Background video preparation failed; submit will surface the upload error", {
        filename: file.name,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

export async function uploadVideoWithFastPath({
  file,
  area,
  uploadViaServer,
  maxSeconds = MAX_VIDEO_SECONDS,
}: {
  file: File;
  area: UploadArea;
  uploadViaServer: (file: File) => Promise<string>;
  /** The post kind's limit: events 60 s, every other video 120 s. */
  maxSeconds?: number;
}): Promise<string> {
  await assertVideoLength(file, maxSeconds);
  let uploads = uploadedVideos.get(file);
  if (!uploads) {
    uploads = new Map();
    uploadedVideos.set(file, uploads);
  }
  const existing = uploads.get(area);
  if (existing && existing.expires > Date.now()) return existing.promise;

  // Retain successful work during a form retry; failed attempts remain retryable.
  // File identity and upload area prevent unrelated selections sharing results.
  const entry = { promise: Promise.resolve(""), expires: Infinity };
  entry.promise = (async () => {
    const uploadFile = await prepareVideoForUpload(file);
    // Every video goes through the server-validated /api/media/upload route;
    // the direct-to-storage routes it once tried first are retired.
    const url = await withUploadSlot(() => uploadViaServer(uploadFile));
    if (!url) throw new Error("Video upload returned no URL. Please retry.");
    entry.expires = Date.now() + 30 * 60_000;
    return url;
  })().catch((error) => {
    if (uploads.get(area) === entry) uploads.delete(area);
    throw error;
  });
  uploads.set(area, entry);
  return entry.promise;
}

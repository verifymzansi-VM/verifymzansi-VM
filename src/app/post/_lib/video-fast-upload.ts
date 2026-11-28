import {
  prepareVideoUpload,
  VideoTranscodeError,
  type PreparedVideo,
} from "@/lib/media/compress-before-upload";
import { MAX_VIDEO_ORIGINAL_BYTES } from "@/lib/media/upload-policy";
import { extractVideoFrame } from "@/lib/media/video-frame";
import { VIDEO_COVER_NEEDED } from "@/lib/forms/video-cover-photo";
import type { VideoSource } from "@/lib/media/video-rule";
import { MAX_VIDEO_SECONDS, videoLengthProblem } from "@/lib/media/video-length";
import { readVideoLengthSeconds } from "@/lib/media/video-length-client";
import { normalizeSelectedFile } from "@/lib/utils/media-upload";
import { createLogger } from "@/lib/utils/logger";
import type { UploadArea } from "@/types/enums";

const log = createLogger("VideoFastUpload");

const preparedVideoUploads = new WeakMap<File, Promise<PreparedVideo>>();
const uploadedVideos = new WeakMap<
  File,
  Map<string, { promise: Promise<string>; expires: number }>
>();
/**
 * Conversion progress of each video still being prepared, so a submit that
 * starts after the pick-time preparation can show it. An entry lives only
 * while its preparation runs and is removed when it settles.
 */
const preparationProgress = new Map<
  File,
  { percent: number; listeners: Set<(p: number) => void> }
>();

/** The video's progress on the submit screen: converting first, then sending. */
export type VideoUploadProgress = {
  phase: "preparing" | "uploading";
  percent: number;
  /** The file this reading is for, so several videos can share one progress bar. */
  file?: File;
};

/** How many preparations are still reporting progress (for tests). */
export function pendingVideoPreparationCount(): number {
  return preparationProgress.size;
}

function watchPreparation(file: File, listener: (percent: number) => void): () => void {
  const entry = preparationProgress.get(file);
  if (!entry) return () => {};
  listener(entry.percent);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}
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
function assertVideoLength(seconds: number | null, maxSeconds: number): void {
  const problem = videoLengthProblem(seconds, maxSeconds);
  if (problem) throw new VideoTranscodeError(`${problem}.`);
}

async function prepareVideoForUpload(file: File): Promise<PreparedVideo> {
  // A larger original is accepted only to be converted; 50 MB caps the stored file.
  if (!file.size || file.size > MAX_VIDEO_ORIGINAL_BYTES) {
    throw new VideoTranscodeError("Select a non-empty video up to 300 MB.");
  }
  const existing = preparedVideoUploads.get(file);
  if (existing) {
    return existing;
  }

  const progress = { percent: 0, listeners: new Set<(p: number) => void>() };
  preparationProgress.set(file, progress);
  const onProgress = (percent: number) => {
    progress.percent = percent;
    for (const listener of progress.listeners) listener(percent);
  };

  // Kept as it is when it meets the keep rule, else remuxed or converted; a
  // video whose headers cannot be read is converted, so what is uploaded can
  // be measured (an empty track or a trailer can hide its length).
  const prepared = prepareVideoUpload(file, { onProgress })
    .then(({ file: preparedFile, source }) => ({
      file: normalizeSelectedFile(preparedFile),
      source,
    }))
    .catch((error) => {
      preparedVideoUploads.delete(file);
      throw error;
    })
    .finally(() => {
      progress.listeners.clear();
      if (preparationProgress.get(file) === progress) preparationProgress.delete(file);
    });
  preparedVideoUploads.set(file, prepared);
  return prepared;
}

/**
 * The video the cover frame is taken from: the prepared (kept, remuxed or
 * converted) file, so the frame matches what plays. When preparation fails
 * the original is used; the submit shows why the video cannot go up.
 */
export function prepareVideoForCover(
  file: File,
  onProgress: (percent: number) => void
): Promise<File> {
  const preparing = prepareVideoForUpload(file);
  const stopWatching = watchPreparation(file, onProgress);
  return preparing
    .then(
      (prepared) => prepared.file,
      () => file
    )
    .finally(stopWatching);
}

/** Whether this video is still being kept, remuxed or converted (a submit may wait for it). */
export function isVideoPreparing(file: File | undefined): boolean {
  return !!file && preparationProgress.has(file);
}

/** No cover frame could be taken at submit for a post that needs one. */
export class VideoCoverMissingError extends Error {
  override name = "VideoCoverMissingError";
  constructor() {
    super(VIDEO_COVER_NEEDED);
  }
}

/**
 * The cover to upload with a video at submit: the one chosen, or, when the
 * poster submitted before the frame picker had a frame (its original could
 * not be shown and the video was still being prepared), a frame from the
 * prepared video at 1 s. No submit goes out without a cover just because the
 * preparation was still running. When no frame can be taken (a 15 s timeout
 * or a canvas failure) and the post has no photo (`required`), the submit
 * stops with VideoCoverMissingError instead of saving a post with no cover.
 */
export async function videoCoverForSubmit(
  video: File | undefined,
  cover: File[],
  required = false
): Promise<File[]> {
  if (cover.length > 0 || !video) return cover;
  const frame = await extractVideoFrame(await prepareVideoForCover(video, () => {}));
  if (frame) return [frame];
  if (required) throw new VideoCoverMissingError();
  return [];
}

export function prewarmVideoForFastUpload(file: File): Promise<PreparedVideo> {
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
  onProgress,
}: {
  file: File;
  area: UploadArea;
  uploadViaServer: (
    file: File,
    onUploadProgress: (percent: number) => void,
    source: VideoSource
  ) => Promise<string>;
  /** The post kind's limit: events 60 s, every other video 120 s. */
  maxSeconds?: number;
  onProgress?: (progress: VideoUploadProgress) => void;
}): Promise<string> {
  // A readable original over the limit is refused before any conversion work.
  // An unreadable one (MediaRecorder WebM, some MOV) is measured once converted.
  const original = await readVideoLengthSeconds(file);
  if (original !== null) assertVideoLength(original, maxSeconds);
  let uploads = uploadedVideos.get(file);
  if (!uploads) {
    uploads = new Map();
    uploadedVideos.set(file, uploads);
  }
  // The limit is part of the key: an upload checked against 2 minutes is not
  // reused for an event (1 minute).
  const slot = `${area}:${maxSeconds}`;
  const existing = uploads.get(slot);
  if (existing && existing.expires > Date.now()) return existing.promise;

  // Retain successful work during a form retry; failed attempts remain retryable.
  // File identity and upload area prevent unrelated selections sharing results.
  const entry = { promise: Promise.resolve(""), expires: Infinity };
  entry.promise = (async () => {
    const preparing = prepareVideoForUpload(file);
    const stopWatching = watchPreparation(file, (percent) =>
      onProgress?.({ phase: "preparing", percent, file })
    );
    let prepared: PreparedVideo;
    try {
      prepared = await preparing;
    } finally {
      stopWatching();
    }
    const uploadFile = prepared.file;
    // What is uploaded must itself have a readable length within the limit.
    assertVideoLength(await readVideoLengthSeconds(uploadFile), maxSeconds);
    // Every video goes through the server-validated /api/media/upload route;
    // the direct-to-storage routes it once tried first are retired.
    const url = await withUploadSlot(() => {
      onProgress?.({ phase: "uploading", percent: 0, file });
      return uploadViaServer(
        uploadFile,
        (percent) => onProgress?.({ phase: "uploading", percent, file }),
        prepared.source
      );
    });
    if (!url) throw new Error("Video upload returned no URL. Please retry.");
    entry.expires = Date.now() + 30 * 60_000;
    return url;
  })().catch((error) => {
    if (uploads.get(slot) === entry) uploads.delete(slot);
    throw error;
  });
  uploads.set(slot, entry);
  return entry.promise;
}

import { compressVideoForUpload, VideoTranscodeError } from "@/lib/media/compress-before-upload";
import { MAX_VIDEO_UPLOAD_BYTES, videoUploadTimeoutMs } from "@/lib/media/upload-policy";
import { normalizeSelectedFile } from "@/lib/utils/media-upload";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { createLogger } from "@/lib/utils/logger";
import type { UploadArea } from "@/types/enums";

const log = createLogger("VideoFastUpload");

type DirectUploadUrlResponse = {
  uploadUrl?: string;
  publicUrl?: string;
  key?: string;
};

type DirectUploadDescriptor = {
  key: string;
  publicUrl: string;
  contentType: string;
  size: number;
  area: UploadArea;
};

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
function createTimeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("Direct video upload timed out", "AbortError"));
  }, ms);

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeoutId),
  };
}

async function prepareVideoForUpload(file: File): Promise<File> {
  if (!file.size || file.size > MAX_VIDEO_UPLOAD_BYTES) {
    throw new VideoTranscodeError("Select a non-empty video up to 50 MB.");
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
          "The converted video exceeds the 50 MB upload limit. Try a shorter clip."
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

async function verifyDirectUpload(upload: DirectUploadDescriptor): Promise<boolean> {
  const completeResponse = await fetchWithRetry("/api/media/upload-complete", {
    method: "POST",
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(upload),
  });

  return completeResponse.ok;
}

async function uploadVideoDirectToR2(file: File, area: UploadArea): Promise<string | null> {
  try {
    const signedUrlResponse = await fetchWithRetry("/api/media/upload-url", {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size,
        area,
      }),
    });

    if (!signedUrlResponse.ok) {
      log.warn("Direct video upload URL unavailable; falling back to validated upload endpoint", {
        status: signedUrlResponse.status,
      });
      return null;
    }

    const signedUrlPayload = (await signedUrlResponse
      .json()
      .catch(() => null)) as DirectUploadUrlResponse | null;
    const uploadUrl = signedUrlPayload?.uploadUrl;
    const publicUrl = signedUrlPayload?.publicUrl;

    if (!uploadUrl || !publicUrl || !signedUrlPayload?.key) {
      log.warn("Direct video upload URL response was incomplete; falling back");
      return null;
    }

    const uploadDescriptor: DirectUploadDescriptor = {
      key: signedUrlPayload.key,
      publicUrl,
      contentType: file.type,
      size: file.size,
      area,
    };

    const timeout = createTimeoutSignal(videoUploadTimeoutMs(file.size));
    let uploadResponse: Response;
    try {
      uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
        signal: timeout.signal,
      });
    } catch (error) {
      const verified = await verifyDirectUpload(uploadDescriptor).catch((cleanupError) => {
        log.warn("Direct video upload cleanup failed after PUT error", {
          uploadError: error instanceof Error ? error.message : String(error),
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
        return false;
      });
      if (verified) return publicUrl;
      throw error;
    } finally {
      timeout.cancel();
    }

    if (!uploadResponse.ok) {
      log.warn("Direct video upload failed; falling back to validated upload endpoint", {
        status: uploadResponse.status,
      });
      const verified = await verifyDirectUpload(uploadDescriptor).catch((error) => {
        log.warn("Direct video upload cleanup failed before fallback", {
          status: uploadResponse.status,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      });
      if (verified) return publicUrl;
      return null;
    }

    if (!(await verifyDirectUpload(uploadDescriptor))) {
      log.warn(
        "Direct video upload verification failed; falling back to validated upload endpoint",
        { reason: "upload_complete_rejected" }
      );
      return null;
    }

    return publicUrl;
  } catch (error) {
    log.warn("Direct video upload threw; falling back to validated upload endpoint", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function uploadVideoWithFastPath({
  file,
  area,
  uploadViaServer,
}: {
  file: File;
  area: UploadArea;
  uploadViaServer: (file: File) => Promise<string>;
}): Promise<string> {
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
    const url = await withUploadSlot(async () => {
      const directUrl = await uploadVideoDirectToR2(uploadFile, area);
      return directUrl || (await uploadViaServer(uploadFile));
    });
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

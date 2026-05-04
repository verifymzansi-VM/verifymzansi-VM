import { compressVideoForUpload } from "@/lib/media/compress-before-upload";
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

const preparedVideoUploads = new WeakMap<File, Promise<File>>();
const VIDEO_PREPARE_TIMEOUT_MS = 60_000;
const DIRECT_UPLOAD_TIMEOUT_MS = 60_000;

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
  const existing = preparedVideoUploads.get(file);
  if (existing) {
    return existing;
  }

  const prepared = compressVideoForUpload(file, {
    requireCompatibleOutput: true,
    timeoutMs: VIDEO_PREPARE_TIMEOUT_MS,
  })
    .then((preparedFile) => normalizeSelectedFile(preparedFile))
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

    const timeout = createTimeoutSignal(DIRECT_UPLOAD_TIMEOUT_MS);
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
    } finally {
      timeout.cancel();
    }

    if (!uploadResponse.ok) {
      log.warn("Direct video upload failed; falling back to validated upload endpoint", {
        status: uploadResponse.status,
      });
      return null;
    }

    const completeResponse = await fetchWithRetry("/api/media/upload-complete", {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        key: signedUrlPayload.key,
        publicUrl,
        contentType: file.type,
        size: file.size,
        area,
      }),
    });

    if (!completeResponse.ok) {
      log.warn(
        "Direct video upload verification failed; falling back to validated upload endpoint",
        {
          status: completeResponse.status,
        }
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
  const uploadFile = await prepareVideoForUpload(file);
  const directUrl = await uploadVideoDirectToR2(uploadFile, area);
  if (directUrl) {
    return directUrl;
  }

  return uploadViaServer(uploadFile);
}

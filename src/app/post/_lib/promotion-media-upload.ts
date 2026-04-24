import { withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { createLogger } from "@/lib/utils/logger";
import { VideoTranscodeError, compressVideoForUpload } from "@/lib/media/compress-before-upload";
import { normalizeCreatePostRuntimeError } from "@/app/post/_lib/create-post-errors";
import {
  appendTraceId,
  getPayloadError,
  getPayloadTraceId,
  parseUploadJson,
  parseUploadResponse,
} from "@/app/post/_lib/media-upload-response";
import type { UploadArea } from "@/types/enums";

const log = createLogger("PromotionMediaUpload");

export type PromotionMediaField = "images" | "videos" | "video_thumbnail" | "logo_url";

const FIELD_MESSAGES: Record<PromotionMediaField, string> = {
  images: "One or more photos failed to upload. Retry the selected files.",
  videos: "One or more videos failed to upload. Retry the selected files.",
  video_thumbnail: "Video thumbnail upload failed. Retry the selected image.",
  logo_url: "Logo upload failed. Retry the selected image.",
};

const FORM_MESSAGE =
  "Selected media could not be uploaded. Retry the highlighted files and try again.";

function toPromotionMediaUploadError(
  field: PromotionMediaField,
  error: unknown
): PromotionMediaUploadError {
  if (error instanceof PromotionMediaUploadError) {
    return error;
  }

  return new PromotionMediaUploadError(
    field,
    normalizeCreatePostRuntimeError(error, FIELD_MESSAGES[field])
  );
}

async function uploadPromotionVideosViaServer({
  files,
  area,
}: {
  files: File[];
  area: UploadArea;
}): Promise<string[]> {
  const uploadData = new FormData();
  uploadData.append("area", area);
  files.forEach((file) => uploadData.append("files", file));

  const response = await fetchWithRetry("/api/media/upload", {
    method: "POST",
    headers: withCsrfHeaders(),
    body: uploadData,
  });

  const payload = await parseUploadJson(response);
  const { urls, errors } = parseUploadResponse(payload);
  const uploadSucceeded = response.ok && errors.length === 0 && urls.length === files.length;

  if (!uploadSucceeded) {
    const payloadError = getPayloadError(payload);
    const detail = errors[0] ?? payloadError ?? `Failed to upload video (HTTP ${response.status})`;
    const traceId = getPayloadTraceId(payload, response);
    throw new PromotionMediaUploadError(
      "videos",
      appendTraceId(
        normalizeCreatePostRuntimeError(new Error(detail), FIELD_MESSAGES.videos),
        traceId
      )
    );
  }

  return urls;
}

class PromotionMediaUploadError extends Error {
  readonly field: PromotionMediaField;

  constructor(field: PromotionMediaField, message?: string) {
    super(message ?? FIELD_MESSAGES[field]);
    this.name = "PromotionMediaUploadError";
    this.field = field;
  }
}

export function getPromotionMediaUploadErrorState(error: unknown): {
  formError: string;
  fieldErrors: Record<string, string>;
} | null {
  if (!(error instanceof PromotionMediaUploadError)) {
    return null;
  }

  return {
    formError: FORM_MESSAGE,
    fieldErrors: {
      [error.field]: error.message,
    },
  };
}

export async function uploadRequiredPromotionMedia({
  files,
  area,
  field,
}: {
  files: File[];
  area: UploadArea;
  field: PromotionMediaField;
}): Promise<string[]> {
  if (files.length === 0) return [];

  try {
    const uploadData = new FormData();
    uploadData.append("area", area);
    files.forEach((file) => uploadData.append("files", file));

    const response = await fetchWithRetry("/api/media/upload", {
      method: "POST",
      headers: withCsrfHeaders(),
      body: uploadData,
    });

    const payload = await parseUploadJson(response);
    const { urls, errors } = parseUploadResponse(payload);
    const uploadSucceeded = response.ok && errors.length === 0 && urls.length === files.length;

    if (!uploadSucceeded) {
      log.warn("Blocking promotion-style save because media upload failed", {
        field,
        area,
        attemptedCount: files.length,
        uploadedCount: urls.length,
        status: response.status,
        errors,
        payloadError: getPayloadError(payload),
      });
      throw new PromotionMediaUploadError(field);
    }

    return urls;
  } catch (error) {
    throw toPromotionMediaUploadError(field, error);
  }
}

export async function uploadPromotionVideoFiles({
  files,
  area,
}: {
  files: File[];
  area: UploadArea;
}): Promise<string[]> {
  if (files.length === 0) return [];

  const compressed: File[] = [];
  try {
    for (const file of files) {
      compressed.push(await compressVideoForUpload(file, { requireCompatibleOutput: true }));
    }
  } catch (error) {
    if (error instanceof VideoTranscodeError) {
      throw new PromotionMediaUploadError("videos", error.message);
    }
    throw error;
  }

  try {
    return await uploadPromotionVideosViaServer({ files: compressed, area });
  } catch (error) {
    log.warn("Validated promotion-style video upload failed", {
      area,
      fileCount: compressed.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw toPromotionMediaUploadError("videos", error);
  }
}

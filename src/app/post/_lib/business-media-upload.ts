import { createLogger } from "@/lib/utils/logger";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
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

const log = createLogger("BusinessMediaUpload");

export type BusinessMediaField =
  | "logo_url"
  | "cover_photo"
  | "gallery_photos"
  | "cover_video"
  | "video_thumbnail";

const FIELD_MESSAGES: Record<BusinessMediaField, string> = {
  logo_url: "Business logo upload failed. Retry the selected image.",
  cover_photo: "Cover photo upload failed. Retry the selected image.",
  gallery_photos: "One or more profile photos failed to upload. Retry the selected files.",
  cover_video: "Promo video upload failed. Retry the selected file.",
  video_thumbnail: "Video thumbnail upload failed. Retry the selected image.",
};

const FORM_MESSAGE =
  "Selected business media could not be uploaded. Retry the highlighted files and try again.";

function toBusinessMediaUploadError(
  field: BusinessMediaField,
  error: unknown
): BusinessMediaUploadError {
  if (error instanceof BusinessMediaUploadError) {
    return error;
  }

  return new BusinessMediaUploadError(
    field,
    normalizeCreatePostRuntimeError(error, FIELD_MESSAGES[field])
  );
}

async function uploadBusinessVideoViaServer({
  file,
  area,
}: {
  file: File;
  area: UploadArea;
}): Promise<string> {
  const uploadData = new FormData();
  uploadData.append("area", area);
  uploadData.append("files", file);

  const response = await fetchWithRetry("/api/media/upload", {
    method: "POST",
    headers: withCsrfHeaders(),
    body: uploadData,
  });

  const payload = await parseUploadJson(response);
  const { urls, errors } = parseUploadResponse(payload);
  const uploadSucceeded = response.ok && errors.length === 0 && urls.length === 1;

  if (!uploadSucceeded) {
    const payloadError = getPayloadError(payload);
    const detail = errors[0] ?? payloadError ?? `Failed to upload video (HTTP ${response.status})`;
    const traceId = getPayloadTraceId(payload, response);
    throw new BusinessMediaUploadError(
      "cover_video",
      appendTraceId(
        normalizeCreatePostRuntimeError(new Error(detail), FIELD_MESSAGES.cover_video),
        traceId
      )
    );
  }

  return urls[0] ?? "";
}

class BusinessMediaUploadError extends Error {
  readonly field: BusinessMediaField;

  constructor(field: BusinessMediaField, message?: string) {
    super(message ?? FIELD_MESSAGES[field]);
    this.name = "BusinessMediaUploadError";
    this.field = field;
  }
}

export function getBusinessMediaUploadErrorState(error: unknown): {
  formError: string;
  fieldErrors: Record<string, string>;
} | null {
  if (!(error instanceof BusinessMediaUploadError)) {
    return null;
  }

  return {
    formError: FORM_MESSAGE,
    fieldErrors: {
      [error.field]: error.message,
    },
  };
}

export async function uploadRequiredBusinessMedia({
  files,
  area,
  field,
}: {
  files: File[];
  area: UploadArea;
  field: BusinessMediaField;
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
      log.warn("Blocking business save because media upload failed", {
        field,
        area,
        attemptedCount: files.length,
        uploadedCount: urls.length,
        status: response.status,
        errors,
        payloadError: getPayloadError(payload),
      });
      throw new BusinessMediaUploadError(field);
    }

    return urls;
  } catch (error) {
    throw toBusinessMediaUploadError(field, error);
  }
}

export async function uploadRequiredBusinessVideo({
  file,
  area,
}: {
  file: File;
  area: UploadArea;
}): Promise<string> {
  let compressed: File;
  try {
    compressed = await compressVideoForUpload(file, { requireCompatibleOutput: true });
  } catch (error) {
    if (error instanceof VideoTranscodeError) {
      throw new BusinessMediaUploadError("cover_video", error.message);
    }
    throw error;
  }

  try {
    return await uploadBusinessVideoViaServer({ file: compressed, area });
  } catch (error) {
    log.warn("Validated business video upload failed", {
      field: "cover_video",
      area,
      filename: compressed.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw toBusinessMediaUploadError("cover_video", error);
  }
}

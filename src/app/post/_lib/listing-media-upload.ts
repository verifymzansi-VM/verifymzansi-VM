import { VideoTranscodeError } from "@/lib/media/compress-before-upload";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { createLogger } from "@/lib/utils/logger";
import { uploadVideoWithFastPath } from "@/app/post/_lib/video-fast-upload";
import { normalizeCreatePostRuntimeError } from "@/app/post/_lib/create-post-errors";
import {
  appendTraceId,
  getPayloadError,
  getPayloadTraceId,
  parseUploadJson,
  parseUploadResponse,
} from "@/app/post/_lib/media-upload-response";
import type { UploadArea } from "@/types/enums";

const log = createLogger("ListingMediaUpload");

const VIDEO_FIELD_MESSAGE = "Video upload failed. Retry the selected file.";
const FORM_MESSAGE =
  "Selected listing media could not be uploaded. Retry the highlighted files and try again.";

class ListingMediaUploadError extends Error {
  readonly field = "videos";

  constructor(message?: string) {
    super(message ?? VIDEO_FIELD_MESSAGE);
    this.name = "ListingMediaUploadError";
  }
}

function toListingVideoUploadError(error: unknown): ListingMediaUploadError {
  if (error instanceof ListingMediaUploadError) {
    return error;
  }

  return new ListingMediaUploadError(normalizeCreatePostRuntimeError(error, VIDEO_FIELD_MESSAGE));
}

async function uploadListingVideoViaServer({
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
    throw new ListingMediaUploadError(
      appendTraceId(
        normalizeCreatePostRuntimeError(new Error(detail), VIDEO_FIELD_MESSAGE),
        traceId
      )
    );
  }

  return urls[0] ?? "";
}

export function getListingMediaUploadErrorState(error: unknown): {
  formError: string;
  fieldErrors: Record<string, string>;
} | null {
  if (!(error instanceof ListingMediaUploadError)) {
    return null;
  }

  return {
    formError: FORM_MESSAGE,
    fieldErrors: {
      [error.field]: error.message,
    },
  };
}

export async function uploadListingVideoFiles({
  files,
  area,
}: {
  files: File[];
  area: UploadArea;
}): Promise<string[]> {
  if (files.length === 0) return [];

  try {
    return await Promise.all(
      files.map((file) =>
        uploadVideoWithFastPath({
          file,
          area,
          uploadViaServer: (uploadFile) => uploadListingVideoViaServer({ file: uploadFile, area }),
        })
      )
    );
  } catch (error) {
    if (error instanceof VideoTranscodeError) {
      throw new ListingMediaUploadError(error.message);
    }
    log.warn("Validated listing video upload failed", {
      area,
      fileCount: files.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw toListingVideoUploadError(error);
  }
}

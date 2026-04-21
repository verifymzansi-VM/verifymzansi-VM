import { createLogger } from "@/lib/utils/logger";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { VideoTranscodeError, compressVideoForUpload } from "@/lib/media/compress-before-upload";
import { normalizeCreatePostRuntimeError } from "@/app/post/_lib/create-post-errors";
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

type UploadResponse = {
  urls?: unknown;
  errors?: unknown;
  error?: unknown;
  message?: unknown;
  traceId?: unknown;
};

function parseUploadResponse(payload: UploadResponse | null) {
  const urls = Array.isArray(payload?.urls)
    ? payload.urls.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const errors = Array.isArray(payload?.errors)
    ? payload.errors.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    : [];

  return { urls, errors };
}

function getPayloadError(payload: UploadResponse | null): string | null {
  if (!payload || typeof payload.error !== "string" || payload.error.trim().length === 0) {
    if (typeof payload?.message !== "string" || payload.message.trim().length === 0) {
      return null;
    }

    return payload.message.trim();
  }

  return payload.error.trim();
}

function getPayloadTraceId(payload: UploadResponse | null, response?: Response): string | null {
  if (payload && typeof payload.traceId === "string" && payload.traceId.trim().length > 0) {
    return payload.traceId.trim();
  }

  if (response && typeof response.headers?.get === "function") {
    const traceId = response.headers.get("x-upload-trace-id");
    if (traceId && traceId.trim().length > 0) {
      return traceId.trim();
    }
  }

  return null;
}

function appendTraceId(message: string, traceId: string | null): string {
  if (!traceId || message.includes(traceId)) {
    return message;
  }

  return `${message} (Trace: ${traceId})`;
}

async function readUploadError(response: Response, fallback: string): Promise<string> {
  const payload = await parseJson(response);
  const payloadError = getPayloadError(payload);
  const traceId = getPayloadTraceId(payload, response);
  const message = payloadError || `${fallback} (HTTP ${response.status})`;

  return appendTraceId(normalizeCreatePostRuntimeError(new Error(message), fallback), traceId);
}

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

  const payload = await parseJson(response);
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

export class BusinessMediaUploadError extends Error {
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

async function parseJson(response: Response): Promise<UploadResponse | null> {
  try {
    return (await response.json()) as UploadResponse;
  } catch {
    return null;
  }
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

    const payload = await parseJson(response);
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
    const urlResponse = await fetchWithRetry("/api/media/upload-url", {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        filename: compressed.name,
        contentType: compressed.type,
        size: compressed.size,
        area,
      }),
    });

    const urlPayload = await parseJson(urlResponse);

    if (!urlResponse.ok) {
      log.warn("Direct business video upload URL generation failed; retrying via server upload", {
        field: "cover_video",
        area,
        filename: file.name,
        contentType: file.type,
        status: urlResponse.status,
        payloadError: getPayloadError(urlPayload),
      });
      throw new Error(await readUploadError(urlResponse, "Failed to get video upload URL"));
    }

    const uploadUrl =
      urlPayload && typeof (urlPayload as Record<string, unknown>).uploadUrl === "string"
        ? ((urlPayload as Record<string, unknown>).uploadUrl as string)
        : null;
    const publicUrl =
      urlPayload && typeof (urlPayload as Record<string, unknown>).publicUrl === "string"
        ? ((urlPayload as Record<string, unknown>).publicUrl as string)
        : null;

    if (!uploadUrl || !publicUrl) {
      log.warn(
        "Direct business video upload returned incomplete payload; retrying via server upload",
        {
          field: "cover_video",
          area,
          hasUploadUrl: Boolean(uploadUrl),
          hasPublicUrl: Boolean(publicUrl),
        }
      );
      throw new Error("Failed to get video upload URL");
    }

    const putResponse = await fetchWithRetry(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": compressed.type },
      body: compressed,
    });

    if (!putResponse.ok) {
      log.warn("Direct business video upload PUT failed; retrying via server upload", {
        field: "cover_video",
        area,
        filename: compressed.name,
        status: putResponse.status,
      });
      throw new Error(`Failed to upload video (HTTP ${putResponse.status})`);
    }

    return publicUrl;
  } catch (error) {
    log.warn("Direct business video upload failed; retrying via server upload", {
      field: "cover_video",
      area,
      filename: compressed.name,
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      return await uploadBusinessVideoViaServer({ file: compressed, area });
    } catch (fallbackError) {
      throw toBusinessMediaUploadError("cover_video", fallbackError);
    }
  }
}

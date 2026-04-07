import { createLogger } from "@/lib/utils/logger";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
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
    return null;
  }

  return payload.error.trim();
}

export class BusinessMediaUploadError extends Error {
  readonly field: BusinessMediaField;

  constructor(field: BusinessMediaField) {
    super(FIELD_MESSAGES[field]);
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
}

export async function uploadRequiredBusinessVideo({
  file,
  area,
}: {
  file: File;
  area: UploadArea;
}): Promise<string> {
  const urlResponse = await fetchWithRetry("/api/media/upload-url", {
    method: "POST",
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
      area,
    }),
  });

  const urlPayload = await parseJson(urlResponse);

  if (!urlResponse.ok) {
    log.warn("Blocking business save because video upload URL generation failed", {
      field: "cover_video",
      area,
      filename: file.name,
      contentType: file.type,
      status: urlResponse.status,
      payloadError: getPayloadError(urlPayload),
    });
    throw new BusinessMediaUploadError("cover_video");
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
    log.warn("Blocking business save because upload URL payload was incomplete", {
      field: "cover_video",
      area,
      hasUploadUrl: Boolean(uploadUrl),
      hasPublicUrl: Boolean(publicUrl),
    });
    throw new BusinessMediaUploadError("cover_video");
  }

  const putResponse = await fetchWithRetry(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  if (!putResponse.ok) {
    log.warn("Blocking business save because video upload PUT failed", {
      field: "cover_video",
      area,
      filename: file.name,
      status: putResponse.status,
    });
    throw new BusinessMediaUploadError("cover_video");
  }

  return publicUrl;
}

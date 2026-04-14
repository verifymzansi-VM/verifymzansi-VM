import { withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { createLogger } from "@/lib/utils/logger";
import { VideoTranscodeError, compressVideoForUpload } from "@/lib/media/compress-before-upload";
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

async function parseJson(response: Response): Promise<UploadResponse | null> {
  try {
    return (await response.json()) as UploadResponse;
  } catch {
    return null;
  }
}

export class PromotionMediaUploadError extends Error {
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
    return await Promise.all(
      compressed.map(async (file) => {
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

        const payload = await parseJson(urlResponse);
        if (!urlResponse.ok) {
          log.warn("Blocking promotion-style save because video upload URL generation failed", {
            area,
            filename: file.name,
            contentType: file.type,
            status: urlResponse.status,
            payloadError: getPayloadError(payload),
          });
          throw new PromotionMediaUploadError("videos");
        }

        const uploadUrl =
          payload && typeof (payload as Record<string, unknown>).uploadUrl === "string"
            ? ((payload as Record<string, unknown>).uploadUrl as string)
            : null;
        const publicUrl =
          payload && typeof (payload as Record<string, unknown>).publicUrl === "string"
            ? ((payload as Record<string, unknown>).publicUrl as string)
            : null;

        if (!uploadUrl || !publicUrl) {
          throw new PromotionMediaUploadError("videos");
        }

        const putResponse = await fetchWithRetry(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!putResponse.ok) {
          throw new PromotionMediaUploadError("videos");
        }

        return publicUrl;
      })
    );
  } catch (error) {
    if (error instanceof PromotionMediaUploadError) {
      throw error;
    }
    throw new PromotionMediaUploadError("videos");
  }
}

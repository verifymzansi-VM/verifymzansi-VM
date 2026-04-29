import { createLogger } from "@/lib/utils/logger";
import { VideoTranscodeError } from "@/lib/media/compress-before-upload";
import { uploadVideoWithFastPath } from "@/app/post/_lib/video-fast-upload";
import { normalizeCreatePostRuntimeError } from "@/app/post/_lib/create-post-errors";
import { uploadMediaViaServer } from "@/app/post/_lib/server-media-upload";
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

  if (error instanceof Error && error.message === FIELD_MESSAGES[field]) {
    return new PromotionMediaUploadError(field, error.message);
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
  return uploadMediaViaServer({
    files,
    area,
    fallbackMessage: FIELD_MESSAGES.videos,
    preferPayloadError: true,
  });
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
  const field =
    error instanceof PromotionMediaUploadError
      ? error.field
      : error &&
          typeof error === "object" &&
          "name" in error &&
          (error as { name: unknown }).name === "PromotionMediaUploadError" &&
          "field" in error
        ? (error as { field: PromotionMediaField }).field
        : null;
  if (!field || !(field in FIELD_MESSAGES)) {
    return null;
  }

  return {
    formError: FORM_MESSAGE,
    fieldErrors: {
      [field]: error instanceof Error ? error.message : FIELD_MESSAGES[field],
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
    return await uploadMediaViaServer({
      files,
      area,
      fallbackMessage: FIELD_MESSAGES[field],
    });
  } catch (error) {
    log.warn("Blocking promotion-style save because media upload failed", {
      field,
      area,
      attemptedCount: files.length,
      error: error instanceof Error ? error.message : String(error),
    });
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

  try {
    return await Promise.all(
      files.map((file) =>
        uploadVideoWithFastPath({
          file,
          area,
          uploadViaServer: (uploadFile) =>
            uploadPromotionVideosViaServer({ files: [uploadFile], area }).then(
              (urls) => urls[0] ?? ""
            ),
        })
      )
    );
  } catch (error) {
    if (error instanceof VideoTranscodeError) {
      throw new PromotionMediaUploadError("videos", error.message);
    }
    log.warn("Validated promotion-style video upload failed", {
      area,
      fileCount: files.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw toPromotionMediaUploadError("videos", error);
  }
}

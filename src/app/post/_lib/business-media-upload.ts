import { createLogger } from "@/lib/utils/logger";
import { VideoTranscodeError } from "@/lib/media/compress-before-upload";
import { uploadVideoWithFastPath } from "@/app/post/_lib/video-fast-upload";
import { normalizeCreatePostRuntimeError } from "@/app/post/_lib/create-post-errors";
import {
  uploadMediaFileViaServer,
  uploadMediaViaServer,
} from "@/app/post/_lib/server-media-upload";
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

  if (error instanceof Error && error.message === FIELD_MESSAGES[field]) {
    return new BusinessMediaUploadError(field, error.message);
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
  return uploadMediaFileViaServer({
    file,
    area,
    fallbackMessage: FIELD_MESSAGES.cover_video,
  });
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
  const field =
    error instanceof BusinessMediaUploadError
      ? error.field
      : error &&
          typeof error === "object" &&
          "name" in error &&
          (error as { name: unknown }).name === "BusinessMediaUploadError" &&
          "field" in error
        ? (error as { field: BusinessMediaField }).field
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
    return await uploadMediaViaServer({
      files,
      area,
      fallbackMessage: FIELD_MESSAGES[field],
    });
  } catch (error) {
    log.warn("Blocking business save because media upload failed", {
      field,
      area,
      attemptedCount: files.length,
      error: error instanceof Error ? error.message : String(error),
    });
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
  try {
    return await uploadVideoWithFastPath({
      file,
      area,
      uploadViaServer: (uploadFile) => uploadBusinessVideoViaServer({ file: uploadFile, area }),
    });
  } catch (error) {
    if (error instanceof VideoTranscodeError) {
      throw new BusinessMediaUploadError("cover_video", error.message);
    }
    log.warn("Validated business video upload failed", {
      field: "cover_video",
      area,
      filename: file.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw toBusinessMediaUploadError("cover_video", error);
  }
}

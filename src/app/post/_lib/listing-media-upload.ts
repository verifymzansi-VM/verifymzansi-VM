import { settleMediaUploads } from "./settle-media-uploads";
import { VideoTranscodeError } from "@/lib/media/compress-before-upload";
import { createLogger } from "@/lib/utils/logger";
import {
  uploadVideoWithFastPath,
  type VideoUploadProgress,
} from "@/app/post/_lib/video-fast-upload";
import { normalizeCreatePostRuntimeError } from "@/app/post/_lib/create-post-errors";
import {
  uploadMediaFileViaServer,
  uploadMediaViaServer,
} from "@/app/post/_lib/server-media-upload";
import type { UploadArea } from "@/types/enums";

const log = createLogger("ListingMediaUpload");

const VIDEO_FIELD_MESSAGE = "Video upload failed. Retry the selected file.";
const FORM_MESSAGE =
  "Selected listing media could not be uploaded. Retry the highlighted files and try again.";

class ListingMediaUploadError extends Error {
  constructor(
    message?: string,
    readonly field = "videos"
  ) {
    super(message ?? VIDEO_FIELD_MESSAGE);
    this.name = "ListingMediaUploadError";
  }
}

export async function uploadListingImages({
  files,
  area,
  field,
  onProgress,
}: {
  files: File[];
  area: UploadArea;
  field: "images" | "logo_url" | "videoThumbnail";
  onProgress?: (percent: number) => void;
}): Promise<string[]> {
  if (!files.length) return [];
  try {
    return await uploadMediaViaServer({
      files,
      area,
      fallbackMessage:
        "One or more selected images could not be uploaded. Retry the selected files.",
      preferPayloadError: true,
      onProgress,
    });
  } catch (error) {
    throw new ListingMediaUploadError(
      normalizeCreatePostRuntimeError(error, "Image upload failed. Please retry."),
      field
    );
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
  onProgress,
}: {
  file: File;
  area: UploadArea;
  onProgress?: (percent: number) => void;
}): Promise<string> {
  return uploadMediaFileViaServer({
    file,
    area,
    fallbackMessage: VIDEO_FIELD_MESSAGE,
    preferPayloadError: true,
    onProgress,
  });
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
  onProgress,
}: {
  files: File[];
  area: UploadArea;
  onProgress?: (progress: VideoUploadProgress) => void;
}): Promise<string[]> {
  if (files.length === 0) return [];

  try {
    return await settleMediaUploads(
      files.map((file) =>
        uploadVideoWithFastPath({
          file,
          area,
          onProgress,
          uploadViaServer: (uploadFile, onUploadProgress) =>
            uploadListingVideoViaServer({ file: uploadFile, area, onProgress: onUploadProgress }),
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

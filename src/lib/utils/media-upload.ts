export const IMAGE_UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export const VIDEO_UPLOAD_MIME_TYPES = ["video/mp4", "video/webm"] as const;

export const ALL_UPLOAD_MIME_TYPES = [
  ...IMAGE_UPLOAD_MIME_TYPES,
  ...VIDEO_UPLOAD_MIME_TYPES,
] as const;

export const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function getExtensionForMimeType(contentType: string): string | null {
  return MIME_EXTENSION_MAP[contentType] ?? null;
}

function sanitizeUploadStem(filename: string): string {
  const trimmed = filename.trim();
  const withoutExtension =
    trimmed.lastIndexOf(".") > 0 ? trimmed.slice(0, trimmed.lastIndexOf(".")) : trimmed;
  const sanitized = withoutExtension
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return sanitized || "upload";
}

export function normalizeUploadFilename(filename: string, contentType: string): string {
  const extension = getExtensionForMimeType(contentType);
  const stem = sanitizeUploadStem(filename);

  return extension ? `${stem}.${extension}` : stem;
}

export function normalizeSelectedFile(file: File): File {
  const normalizedName = normalizeUploadFilename(file.name, file.type);
  if (normalizedName === file.name) {
    return file;
  }

  return new File([file], normalizedName, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

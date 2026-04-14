/**
 * Thin adapter that compresses a video file before upload.
 *
 * Lazy-loads the FFmpeg WASM compressor so non-upload pages pay zero cost.
 * Returns the (possibly compressed) File ready for presigned-URL PUT.
 * On failure the original file is returned — upload still succeeds uncompressed.
 */
export class VideoTranscodeError extends Error {
  constructor(
    message = "This MOV video could not be converted to MP4. Export it as MP4 and try again."
  ) {
    super(message);
    this.name = "VideoTranscodeError";
  }
}

export async function compressVideoForUpload(
  file: File,
  options?: { requireCompatibleOutput?: boolean }
): Promise<File> {
  const { compressVideo } = await import("@/lib/media/video-compressor");
  const result = await compressVideo(file);
  if (options?.requireCompatibleOutput && result.file.type === "video/quicktime") {
    throw new VideoTranscodeError();
  }
  return result.file;
}

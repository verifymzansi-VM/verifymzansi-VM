/**
 * Thin adapter that compresses a video file before upload.
 *
 * Lazy-loads the FFmpeg WASM compressor so non-upload pages pay zero cost.
 * Returns the (possibly compressed) File ready for presigned-URL PUT.
 * On failure the original file is returned — upload still succeeds uncompressed.
 */
export async function compressVideoForUpload(file: File): Promise<File> {
  const { compressVideo } = await import("@/lib/media/video-compressor");
  const result = await compressVideo(file);
  return result.file;
}

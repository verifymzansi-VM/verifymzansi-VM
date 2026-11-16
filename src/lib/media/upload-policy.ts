/** The stored (converted) video: the server refuses anything larger. */
export const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024;
/** A phone original accepted only to be converted first (about 2 minutes of 1080p). */
export const MAX_VIDEO_ORIGINAL_BYTES = 300 * 1024 * 1024;

/** Include response time after sending a full 50 MiB clip over a 0.5 Mbps uplink. */
export function mediaUploadTimeoutMs(bytes: number): number {
  return Math.min(15 * 60_000, Math.max(120_000, Math.ceil((bytes / 62_500) * 1000) + 30_000));
}

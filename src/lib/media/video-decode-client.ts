/**
 * Can this browser show the picked video? (item 84, part D)
 *
 * Some phone videos (for example HEVC in Chrome) load with no picture: the
 * video element errors, or reports a 0 x 0 size. Such a file cannot give a
 * cover frame or a preview, so it is refused when chosen instead of failing
 * later at upload. When the browser does not answer in time the video is
 * accepted, and the existing conversion and server checks decide.
 */

export const UNSUPPORTED_VIDEO_FORMAT_MESSAGE =
  "This video format isn't supported. Try saving it as MP4.";

const DECODE_TIMEOUT_MS = 8000;

/** False only when the browser clearly cannot show the video's picture. */
export function canBrowserShowVideo(file: Blob, timeoutMs = DECODE_TIMEOUT_MS): Promise<boolean> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (showable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(showable);
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish(video.videoWidth > 0 && video.videoHeight > 0);
    video.onerror = () => finish(false);
    video.src = url;
  });
}

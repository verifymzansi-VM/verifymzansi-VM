/**
 * The phone (browser) side of the video length rule (roadmap M4.4). It reads
 * the length from the file's own headers with exactly the code the server
 * runs, so the phone and the server round and refuse alike.
 *
 * A video whose length cannot be read at pick is accepted (unless the
 * browser reads it and finds no picture: an audio file named .mp4): MediaRecorder
 * WebM has none, and some phone MP4s carry an empty track or a trailer after
 * the last box. It is always converted (even a compatible MP4), and the
 * converted MP4 is measured before upload (`video-fast-upload.ts`); only an
 * unreadable or over-long converted file is refused. The server measures it
 * again.
 */
import { readVideoBlobSeconds, videoLengthProblem } from "@/lib/media/video-length";

const measured = new WeakMap<Blob, Promise<number | null>>();

/** The video's length in seconds from its headers, or null when they do not say. */
export function readVideoLengthSeconds(file: Blob): Promise<number | null> {
  const known = measured.get(file);
  if (known) return known;
  const reading = readVideoBlobSeconds(file);
  measured.set(file, reading);
  return reading;
}

/**
 * The message to show when the picked video breaks the form's limit, or null.
 * An unreadable length is decided after conversion, not at pick, except when
 * the browser loads the file and it has no picture (no width or height).
 * When the browser cannot tell (an error or no answer in 5 s) it is accepted
 * and the Submit checks refuse it.
 */
export async function checkPickedVideoLength(
  file: Blob,
  limitSeconds: number
): Promise<string | null> {
  const seconds = await readVideoLengthSeconds(file);
  if (seconds !== null) return videoLengthProblem(seconds, limitSeconds);
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  const noPicture = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve(video.videoWidth === 0 && video.videoHeight === 0);
    };
    video.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    video.muted = true;
    video.preload = "metadata";
    video.src = url;
  });
  video.removeAttribute("src");
  URL.revokeObjectURL(url);
  return noPicture ? NO_VIDEO_TRACK_MESSAGE : null;
}

export const NO_VIDEO_TRACK_MESSAGE = "This file has no video. Choose a video file.";

/**
 * The phone (browser) side of the video length rule (roadmap M4.4). It reads
 * the length from the file's own headers with exactly the code the server
 * runs, so the phone and the server round and refuse alike.
 *
 * A video that must be converted anyway (MOV, WebM, other codecs, over
 * 50 MB) may have no readable length before conversion: MediaRecorder WebM
 * has none. Such a pick is accepted, and the converted MP4 is measured
 * before upload (`video-fast-upload.ts`); the server measures it again.
 */
import { videoNeedsConversion } from "@/lib/media/compress-before-upload";
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
 * An unreadable length is refused only when the file will be uploaded as it is.
 */
export async function checkPickedVideoLength(
  file: Blob,
  limitSeconds: number
): Promise<string | null> {
  const seconds = await readVideoLengthSeconds(file);
  if (seconds === null && (await videoNeedsConversion(file))) return null;
  return videoLengthProblem(seconds, limitSeconds);
}

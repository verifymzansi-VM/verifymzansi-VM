/**
 * The phone (browser) side of the video length rule (roadmap M4.4). Reads the
 * length from the file's own headers first, and asks the browser's video
 * element only when the headers say nothing, so a clip the phone cannot play
 * (HEVC on some Android browsers) is still measured.
 */
import { readVideoBlobSeconds, videoLengthProblem } from "@/lib/media/video-length";

const METADATA_TIMEOUT_MS = 8_000;

function readElementSeconds(file: Blob): Promise<number | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    let settled = false;
    const finish = (seconds: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    };
    const timer = setTimeout(() => finish(null), METADATA_TIMEOUT_MS);
    video.addEventListener("loadedmetadata", () => finish(video.duration), { once: true });
    video.addEventListener("error", () => finish(null), { once: true });
    video.src = url;
  });
}

const measured = new WeakMap<Blob, Promise<number | null>>();

/** The video's length in seconds, or null when neither its headers nor the browser can say. */
export function readVideoLengthSeconds(file: Blob): Promise<number | null> {
  const known = measured.get(file);
  if (known) return known;
  const reading = readVideoBlobSeconds(file).then((seconds) => seconds ?? readElementSeconds(file));
  measured.set(file, reading);
  return reading;
}

/** The message to show when the picked video breaks the form's limit, or null. */
export async function checkPickedVideoLength(
  file: Blob,
  limitSeconds: number
): Promise<string | null> {
  return videoLengthProblem(await readVideoLengthSeconds(file), limitSeconds);
}

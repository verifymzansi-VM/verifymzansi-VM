import { hasDatabaseReason } from "./error-reasons";
import { formatVideoLength, formatVideoLimit } from "../media/video-length";

/** Shown when a post's video was stored before the database kept lengths. */
export const VIDEO_LENGTH_UNKNOWN_MESSAGE =
  "We couldn't check your video's length. Please upload the video again.";

/**
 * What the seller is told when the database refuses a submission for its
 * video's length (roadmap M4.4): the stored length and the post kind's limit,
 * which the refusal carries as "<whole seconds>/<limit>". Null for any other
 * error.
 */
export function videoLengthRefusalMessage(
  error: { code?: string | null; details?: string | null; hint?: string | null } | null | undefined
): string | null {
  if (!error || error.code !== "22023") return null;
  if (hasDatabaseReason(error, "video_length_unknown")) return VIDEO_LENGTH_UNKNOWN_MESSAGE;
  if (!hasDatabaseReason(error, "video_too_long")) return null;
  const facts = /^(\d{1,7})\/(60|120)$/.exec(error.hint ?? "");
  if (!facts) return "Your video is longer than this post allows. Please choose a shorter video.";
  return `Your video is ${formatVideoLength(Number(facts[1]))}; the limit is ${formatVideoLimit(Number(facts[2]))}`;
}

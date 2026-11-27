/**
 * The keep rule for stored videos (video plan, phase 1): an MP4 every phone
 * browser plays as it is. The upload server checks every video against it
 * (src/lib/foundation/media-upload.ts); the posting forms will use the same
 * rule to decide whether a picked file can be kept, remuxed or converted.
 *
 * Only headers are read (video-length.ts), nothing is decoded. Profiles 66,
 * 77 and 100 (Baseline, Main, High) are 8-bit 4:2:0 by definition.
 */
import type { VideoFileFacts } from "./video-length";

/** The stored-video cap (also checked before any parsing). */
const MAX_KEPT_VIDEO_BYTES = 52_428_800;
/** Average bitrate of the whole file: size x 8 / length. */
export const MAX_KEPT_VIDEO_BITS_PER_SECOND = 4_000_000;

const PROFILES = new Set([66, 77, 100]);
const MAX_LEVEL = 42;
const MAX_LONG_EDGE = 1920;
/** 1080p is often coded as 1088 lines (whole 16-pixel macroblocks). */
const MAX_SHORT_EDGE = 1088;
/** 60 fps is kept only up to 720p; tolerance covers 29.97 and variable rates. */
const HIGH_FPS_SHORT_EDGE = 720;
const FPS_TOLERANCE = 0.5;

export type VideoRuleProblem =
  | "not_faststart"
  | "video_codec"
  | "video_profile"
  | "video_level"
  | "video_size"
  | "video_fps"
  | "audio_codec"
  | "extra_tracks"
  | "file_size"
  | "bitrate";

/** What a member is told when the server refuses a video under the rule. */
export const VIDEO_RULE_MESSAGE =
  "This video can't be stored as it is. Pick it again in the posting form so it can be prepared, or export it as MP4 (H.264, up to 1080p).";

/** The first rule the file breaks, or null when it can be stored as it is. */
export function videoRuleProblem(
  facts: VideoFileFacts,
  sizeBytes: number
): VideoRuleProblem | null {
  const { video } = facts;
  const longEdge = Math.max(video.width, video.height);
  const shortEdge = Math.min(video.width, video.height);
  const maxFps = (shortEdge <= HIGH_FPS_SHORT_EDGE ? 60 : 30) + FPS_TOLERANCE;
  if (!facts.faststart) return "not_faststart";
  if (facts.videoTracks !== 1 || (video.codec !== "avc1" && video.codec !== "avc3"))
    return "video_codec";
  if (video.profile === null || !PROFILES.has(video.profile)) return "video_profile";
  if (video.level === null || video.level > MAX_LEVEL) return "video_level";
  if (!shortEdge || longEdge > MAX_LONG_EDGE || shortEdge > MAX_SHORT_EDGE) return "video_size";
  if (!(video.fps > 0 && video.fps <= maxFps)) return "video_fps";
  if (facts.audioTracks > 1 || facts.audio === "other") return "audio_codec";
  if (facts.otherTracks > 0) return "extra_tracks";
  if (sizeBytes > MAX_KEPT_VIDEO_BYTES) return "file_size";
  if ((sizeBytes * 8) / facts.seconds > MAX_KEPT_VIDEO_BITS_PER_SECOND) return "bitrate";
  return null;
}

/**
 * The facts stored with an uploaded video (`video_facts` on its media row):
 * what the file is, and which rule it broke (null when none). Length, size
 * and so bitrate are already stored on the row.
 */
export function videoUploadFacts(facts: VideoFileFacts, problem: VideoRuleProblem | null) {
  const { video } = facts;
  return {
    codec: video.codec.slice(0, 8),
    ...(video.profile === null ? {} : { profile: video.profile }),
    ...(video.level === null ? {} : { level: video.level }),
    width: video.width,
    height: video.height,
    ...(Number.isFinite(video.fps) ? { fps: Math.round(video.fps * 100) / 100 } : {}),
    faststart: facts.faststart,
    audio: facts.audio,
    problem,
  };
}
